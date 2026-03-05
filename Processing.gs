// 取得・抽出・正規化・マッチング・記録までの処理フロー全体を統括する。

const ProcessingService = {
  recoverStuckThreads(config) {
    const stuckThreads = GmailRepository.fetchStuckProcessingThreads(config);

    stuckThreads.forEach((thread) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];
      const messageId = latestMessage.getId();

      if (ProcessLogRepository.hasSuccessEntry(config, messageId, 'MATCH_AND_DRAFT')) {
        GmailRepository.moveToProcessed(config, thread);
      } else {
        GmailRepository.moveToError(config, thread);
        AlertService.notifyError(
          config,
          latestMessage,
          new Error('前回バッチで処理中のまま残留していたスレッドです')
        );
      }
    });
  },

  processThread(config, thread) {
    GmailRepository.moveToProcessing(config, thread);
    const messages = thread.getMessages();
    const latestMessage = messages[messages.length - 1];

    try {
      this.log(config, latestMessage, 'INGEST', 'STARTED', 'Start processing thread');

      const rawRecord = this.ingestRaw(config, latestMessage);
      this.log(config, latestMessage, 'INGEST', 'SUCCESS', `raw_id=${rawRecord.raw_id}`);

      const parsedResult = ExtractionPipeline.run(config, rawRecord);
      const parsedId = this.persistParsed(config, rawRecord, parsedResult);
      this.log(config, latestMessage, 'PARSE', 'SUCCESS', `parsed_id=${parsedId}`);

      const normalized = EntityNormalizer.normalize(parsedResult, rawRecord);
      const normalizedId = this.persistNormalized(config, rawRecord, parsedId, normalized);
      this.log(config, latestMessage, 'NORMALIZE', 'SUCCESS', `normalized_id=${normalizedId}`);

      const dbSheetName = normalized.entityType === 'engineer'
        ? config.sheetNames.engineerDb
        : config.sheetNames.projectDb;
      const sourceNormalizedRecord = SpreadsheetRepository.findFirst(
        config,
        dbSheetName,
        (row) => String(row.normalized_id) === String(normalizedId)
      );

      const allMatches = MatcherService.findCandidates(config, sourceNormalizedRecord);

      // 重複マッチ防止: 既存のsource-targetペアを除外
      const existingMatches = MatchRepository.listBySourceId(config, sourceNormalizedRecord.normalized_id);
      const existingTargetIds = new Set(existingMatches.map((m) => String(m.target_normalized_id)));
      const matches = allMatches.filter((m) => !existingTargetIds.has(String(m.target.normalized_id)));

      const drafts = DraftService.createDrafts(config, sourceNormalizedRecord, matches);
      this.persistMatches(config, sourceNormalizedRecord, matches, drafts);

      this.log(
        config,
        latestMessage,
        'MATCH_AND_DRAFT',
        'SUCCESS',
        `matches=${matches.length}, drafts=${drafts.length}`
      );

      GmailRepository.moveToProcessed(config, thread);
    } catch (error) {
      // 各ステップを独立実行し、1つが失敗しても残りを試行する
      try { this.log(config, latestMessage, 'PROCESS', 'ERROR', error.message || String(error)); } catch (_) {}
      try { GmailRepository.moveToError(config, thread); } catch (_) {}
      try { AlertService.notifyError(config, latestMessage, error); } catch (_) {}
    }
  },

  ingestRaw(config, message) {
    if (RawInboxRepository.existsByMessageId(config, message.getId())) {
      const existing = SpreadsheetRepository.findFirst(
        config,
        config.sheetNames.rawInbox,
        (row) => String(row.message_id) === String(message.getId())
      );
      return existing;
    }

    const rawRecord = {
      raw_id: Utils.uuid(),
      message_id: message.getId(),
      thread_id: message.getThread().getId(),
      received_at: message.getDate(),
      from_address: message.getFrom() || '',
      to_address: message.getTo() || '',
      subject: message.getSubject() || '',
      original_body: message.getPlainBody() || '',
      normalized_body: Utils.normalizeBody(message.getPlainBody() || ''),
      source_type: 'gmail',
      gmail_labels: message.getThread().getLabels().map((x) => x.getName()).join(','),
      status: 'INGESTED',
      created_at: Utils.nowIso()
    };

    RawInboxRepository.save(config, rawRecord);
    return rawRecord;
  },

  persistParsed(config, rawRecord, parsedResult) {
    const parsedId = Utils.uuid();
    ParsedEntityRepository.save(config, {
      parsed_id: parsedId,
      raw_id: rawRecord.raw_id,
      entity_type: parsedResult.entityType,
      extractor_name: parsedResult.extractorName,
      extractor_version: parsedResult.extractorVersion,
      confidence: parsedResult.confidence,
      warnings_json: Utils.safeJsonStringify(parsedResult.warnings || []),
      raw_fields_json: Utils.safeJsonStringify(parsedResult.rawFields || {}),
      created_at: Utils.nowIso()
    });
    return parsedId;
  },

  persistNormalized(config, rawRecord, parsedId, normalized) {
    const normalizedId = Utils.uuid();

    NormalizedEntityRepository.save(config, {
      normalized_id: normalizedId,
      parsed_id: parsedId,
      raw_id: rawRecord.raw_id,
      entity_type: normalized.entityType,
      display_name: normalized.displayName,
      primary_email: normalized.primaryEmail,
      skills_csv: normalized.skillsCsv,
      location_text: normalized.locationText,
      nearest_station: normalized.normalizedJson.nearestStation || '',
      rate_min: normalized.rateMin,
      rate_max: normalized.rateMax,
      availability_text: normalized.availabilityText,
      remote_type: normalized.remoteType,
      required_skills: normalized.normalizedJson.requiredSkills || '',
      nice_to_have_skills: normalized.normalizedJson.niceToHaveSkills || '',
      client_name: normalized.normalizedJson.clientName || '',
      normalized_json: Utils.safeJsonStringify(normalized.normalizedJson),
      created_at: Utils.nowIso()
    });

    return normalizedId;
  },

  persistMatches(config, sourceNormalizedRecord, matches, drafts) {
    const draftMap = {};
    drafts.forEach((draft) => {
      draftMap[draft.targetNormalizedId] = draft;
    });

    matches.forEach((match) => {
      const draft = draftMap[match.target.normalized_id];
      MatchRepository.save(config, {
        match_id: Utils.uuid(),
        source_normalized_id: sourceNormalizedRecord.normalized_id,
        source_entity_type: sourceNormalizedRecord.entity_type,
        target_normalized_id: match.target.normalized_id,
        target_entity_type: match.target.entity_type,
        score: match.score,
        reason: match.reason,
        draft_to: draft ? draft.draftTo : '',
        draft_subject: draft ? draft.draftSubject : '',
        created_at: Utils.nowIso()
      });
    });
  },

  log(config, message, stage, status, text) {
    ProcessLogRepository.save(config, {
      log_id: Utils.uuid(),
      thread_id: message.getThread().getId(),
      message_id: message.getId(),
      stage,
      status,
      message: text,
      created_at: Utils.nowIso()
    });
  }
};