// Gmailラベル・Spreadsheetシート・定期トリガーの初期セットアップを担う。

const BootstrapService = {
  ensureLabels(config) {
    Object.values(config.labels).forEach((labelName) => {
      if (!GmailApp.getUserLabelByName(labelName)) {
        GmailApp.createLabel(labelName);
      }
    });
  },

  ensureSheets(config) {
    const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);

    this.ensureSheet(spreadsheet, config.sheetNames.rawInbox, SHEET_HEADERS.rawInbox);
    this.ensureSheet(spreadsheet, config.sheetNames.parsedEntities, SHEET_HEADERS.parsedEntities);
    this.ensureSheet(spreadsheet, config.sheetNames.normalizedEntities, SHEET_HEADERS.normalizedEntities);
    this.ensureSheet(spreadsheet, config.sheetNames.matches, SHEET_HEADERS.matches);
    this.ensureSheet(spreadsheet, config.sheetNames.processLog, SHEET_HEADERS.processLog);
  },

  ensureSheet(spreadsheet, sheetName, headers) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (currentHeaders.join('||') !== headers.join('||')) {
      sheet.clear();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  },

  ensureTrigger(config) {
    const triggers = ScriptApp.getProjectTriggers();
    const exists = triggers.some((t) => t.getHandlerFunction() === 'runBatch');
    if (exists) return;

    ScriptApp.newTrigger('runBatch')
      .timeBased()
      .everyMinutes(config.pollMinutes)
      .create();
  }
};