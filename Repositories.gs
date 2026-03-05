// GmailとSpreadsheetに対するデータ取得・保存の永続化処理を担う。

const GmailRepository = {
  fetchUnprocessedThreads(config) {
    const query = `-label:"${config.labels.processing}" -label:"${config.labels.processed}" -label:"${config.labels.error}" newer_than:${config.lookbackDays}d`;
    const threads = GmailApp.search(query, 0, config.batchSize);
    return threads.sort((a, b) => b.getLastMessageDate() - a.getLastMessageDate());
  },

  fetchStuckProcessingThreads(config) {
    const query = `label:"${config.labels.processing}"`;
    return GmailApp.search(query);
  },

  moveToProcessing(config, thread) {
    const toLabel = GmailApp.getUserLabelByName(config.labels.processing);
    if (toLabel) thread.addLabel(toLabel);
  },

  moveToProcessed(config, thread) {
    this.replaceLabels(thread, config.labels.processing, config.labels.processed);
  },

  moveToError(config, thread) {
    this.replaceLabels(thread, config.labels.processing, config.labels.error);
  },

  replaceLabels(thread, fromLabelName, toLabelName) {
    const fromLabel = GmailApp.getUserLabelByName(fromLabelName);
    const toLabel = GmailApp.getUserLabelByName(toLabelName);
    if (fromLabel) thread.removeLabel(fromLabel);
    if (toLabel) thread.addLabel(toLabel);
  }
};

const SpreadsheetRepository = {
  getSpreadsheet(config) {
    return SpreadsheetApp.openById(config.spreadsheetId);
  },

  getSheet(config, sheetName) {
    const sheet = this.getSpreadsheet(config).getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
    return sheet;
  },

  appendObject(config, sheetName, headers, obj) {
    const row = headers.map((header) => obj[header] !== undefined ? obj[header] : '');
    this.getSheet(config, sheetName).appendRow(row);
  },

  listObjects(config, sheetName) {
    const sheet = this.getSheet(config, sheetName);
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return [];
    const headers = values[0];

    return values.slice(1)
      .filter((row) => row.some((cell) => String(cell).trim() !== ''))
      .map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      });
  },

  findFirst(config, sheetName, predicateFn) {
    const rows = this.listObjects(config, sheetName);
    for (const row of rows) {
      if (predicateFn(row)) return row;
    }
    return null;
  }
};

const RawInboxRepository = {
  existsByMessageId(config, messageId) {
    return !!SpreadsheetRepository.findFirst(
      config,
      config.sheetNames.rawInbox,
      (row) => String(row.message_id) === String(messageId)
    );
  },

  save(config, rawRecord) {
    SpreadsheetRepository.appendObject(
      config,
      config.sheetNames.rawInbox,
      SHEET_HEADERS.rawInbox,
      rawRecord
    );
  },

  findByRawId(config, rawId) {
    return SpreadsheetRepository.findFirst(
      config,
      config.sheetNames.rawInbox,
      (row) => String(row.raw_id) === String(rawId)
    );
  }
};

const ParsedEntityRepository = {
  save(config, parsedRecord) {
    SpreadsheetRepository.appendObject(
      config,
      config.sheetNames.parsedEntities,
      SHEET_HEADERS.parsedEntities,
      parsedRecord
    );
  }
};

const NormalizedEntityRepository = {
  _resolve(entityType) {
    if (entityType === 'engineer') {
      return { sheetKey: 'engineerDb', headersKey: 'engineerDb' };
    }
    if (entityType === 'project') {
      return { sheetKey: 'projectDb', headersKey: 'projectDb' };
    }
    throw new Error(`Unknown entity_type for DB save: ${entityType}`);
  },

  save(config, normalizedRecord) {
    const ref = this._resolve(normalizedRecord.entity_type);
    SpreadsheetRepository.appendObject(
      config,
      config.sheetNames[ref.sheetKey],
      SHEET_HEADERS[ref.headersKey],
      normalizedRecord
    );
  },

  listByEntityType(config, entityType) {
    const ref = this._resolve(entityType);
    return SpreadsheetRepository.listObjects(config, config.sheetNames[ref.sheetKey]);
  },

  listAll(config) {
    const engineers = SpreadsheetRepository.listObjects(config, config.sheetNames.engineerDb);
    const projects = SpreadsheetRepository.listObjects(config, config.sheetNames.projectDb);
    return engineers.concat(projects);
  }
};

const MatchRepository = {
  save(config, matchRecord) {
    SpreadsheetRepository.appendObject(
      config,
      config.sheetNames.matches,
      SHEET_HEADERS.matches,
      matchRecord
    );
  },

  listBySourceId(config, sourceNormalizedId) {
    return SpreadsheetRepository.listObjects(config, config.sheetNames.matches)
      .filter((row) => String(row.source_normalized_id) === String(sourceNormalizedId));
  }
};

const ProcessLogRepository = {
  save(config, logRecord) {
    SpreadsheetRepository.appendObject(
      config,
      config.sheetNames.processLog,
      SHEET_HEADERS.processLog,
      logRecord
    );
  },

  hasSuccessEntry(config, messageId, stage) {
    return !!SpreadsheetRepository.findFirst(
      config,
      config.sheetNames.processLog,
      (row) => String(row.message_id) === String(messageId) &&
               String(row.stage) === stage &&
               String(row.status) === 'SUCCESS'
    );
  }
};