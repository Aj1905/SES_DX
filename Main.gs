// アプリ全体の初期化と定期バッチ実行のエントリーポイントを担う。

function setupApp() {
  const config = AppConfig.load();
  BootstrapService.ensureLabels(config);
  BootstrapService.ensureSheets(config);
  BootstrapService.ensureTrigger(config);
}

function runBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) {
    Logger.log('Another execution is running. Skip.');
    return;
  }

  try {
    const config = AppConfig.load();
    BootstrapService.ensureLabels(config);
    BootstrapService.ensureSheets(config);

    // 前回バッチで処理中のまま残留したスレッドを復旧
    ProcessingService.recoverStuckThreads(config);

    const threads = GmailRepository.fetchUnprocessedThreads(config);
    const startTime = Date.now();
    const MAX_EXECUTION_MS = 5 * 60 * 1000; // GAS制限6分の手前で停止

    for (const thread of threads) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        Logger.log('Approaching execution time limit. Stopping batch.');
        break;
      }
      ProcessingService.processThread(config, thread);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * テスト用: 未処理メール1件を取得し、抽出・正規化してスプレッドシートに保存する。
 * マッチングや下書き作成は行わない。ラベルも変更しない。
 * 実行後、Logger.logで抽出結果を確認できる。
 */
function testExtractOne() {
  const config = AppConfig.load();
  BootstrapService.ensureLabels(config);
  BootstrapService.ensureSheets(config);

  const threads = GmailRepository.fetchUnprocessedThreads(config);
  if (threads.length === 0) {
    Logger.log('未処理のスレッドが見つかりません。');
    return;
  }

  const thread = threads[0];
  const messages = thread.getMessages();
  const message = messages[messages.length - 1];

  Logger.log('=== 対象メール ===');
  Logger.log('件名: ' + message.getSubject());
  Logger.log('送信元: ' + message.getFrom());
  Logger.log('日時: ' + message.getDate());

  // 1. 取込
  const rawRecord = {
    raw_id: Utils.uuid(),
    message_id: message.getId(),
    thread_id: thread.getId(),
    received_at: message.getDate(),
    from_address: message.getFrom() || '',
    to_address: message.getTo() || '',
    subject: message.getSubject() || '',
    original_body: message.getPlainBody() || '',
    normalized_body: Utils.normalizeBody(message.getPlainBody() || ''),
    source_type: 'gmail',
    gmail_labels: thread.getLabels().map((x) => x.getName()).join(','),
    status: 'TEST',
    created_at: Utils.nowIso()
  };
  RawInboxRepository.save(config, rawRecord);
  Logger.log('=== rawInbox に保存 (raw_id=' + rawRecord.raw_id + ') ===');

  // 2. 抽出
  const parsedResult = ExtractionPipeline.run(config, rawRecord);
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
  Logger.log('=== parsedEntities に保存 (parsed_id=' + parsedId + ') ===');
  Logger.log('entityType: ' + parsedResult.entityType);
  Logger.log('confidence: ' + parsedResult.confidence);
  Logger.log('rawFields: ' + Utils.safeJsonStringify(parsedResult.rawFields));

  // 3. 正規化
  const normalized = EntityNormalizer.normalize(parsedResult, rawRecord);
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
  const dbName = normalized.entityType === 'engineer' ? '人材DB' : '案件DB';
  Logger.log('=== ' + dbName + ' に保存 (normalized_id=' + normalizedId + ') ===');
  Logger.log('normalizedJson: ' + Utils.safeJsonStringify(normalized.normalizedJson));

  Logger.log('=== テスト完了 ===');
}