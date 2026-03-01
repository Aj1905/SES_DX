// スクリプトプロパティの読み込みと各種設定値・シート定義の管理を担う。

const SHEET_HEADERS = {
  rawInbox: [
    'raw_id',
    'message_id',
    'thread_id',
    'received_at',
    'from_address',
    'to_address',
    'subject',
    'original_body',
    'normalized_body',
    'source_type',
    'gmail_labels',
    'status',
    'created_at'
  ],
  parsedEntities: [
    'parsed_id',
    'raw_id',
    'entity_type',
    'extractor_name',
    'extractor_version',
    'confidence',
    'warnings_json',
    'raw_fields_json',
    'created_at'
  ],
  normalizedEntities: [
    'normalized_id',
    'parsed_id',
    'raw_id',
    'entity_type',
    'normalizer_name',
    'normalizer_version',
    'display_name',
    'primary_email',
    'skills_csv',
    'location_text',
    'rate_min',
    'rate_max',
    'availability_text',
    'remote_type',
    'normalized_json',
    'created_at'
  ],
  matches: [
    'match_id',
    'source_normalized_id',
    'source_entity_type',
    'target_normalized_id',
    'target_entity_type',
    'score',
    'reason',
    'draft_to',
    'draft_subject',
    'created_at'
  ],
  processLog: [
    'log_id',
    'thread_id',
    'message_id',
    'stage',
    'status',
    'message',
    'created_at'
  ]
};

const AppConfig = {
  load() {
    const props = PropertiesService.getScriptProperties().getProperties();

    const config = {
      spreadsheetId: this.require(props, 'SPREADSHEET_ID'),
      managerAlertEmail: this.require(props, 'MANAGER_ALERT_EMAIL'),

      labels: {
        unprocessed: this.require(props, 'UNPROCESSED_LABEL'),
        processing: this.require(props, 'PROCESSING_LABEL'),
        processed: this.require(props, 'PROCESSED_LABEL'),
        error: this.require(props, 'ERROR_LABEL')
      },

      sheetNames: {
        rawInbox: this.require(props, 'RAW_INBOX_SHEET_NAME'),
        parsedEntities: this.require(props, 'PARSED_ENTITIES_SHEET_NAME'),
        normalizedEntities: this.require(props, 'NORMALIZED_ENTITIES_SHEET_NAME'),
        matches: this.require(props, 'MATCHES_SHEET_NAME'),
        processLog: this.require(props, 'PROCESS_LOG_SHEET_NAME')
      },

      batchSize: this.toInt(props.BATCH_SIZE, 20),
      lookbackDays: this.toInt(props.LOOKBACK_DAYS, 30),
      pollMinutes: this.allowedPollMinutes(this.toInt(props.POLL_MINUTES, 5)),
      matchThreshold: this.toInt(props.MATCH_THRESHOLD, 35),
      maxDraftsPerItem: this.toInt(props.MAX_DRAFTS_PER_ITEM, 5),

      draftSenderName: props.DRAFT_SENDER_NAME || 'SES Matching Bot',

      engineerDraftSubjectTemplate:
        props.ENGINEER_DRAFT_SUBJECT_TEMPLATE || '【案件ご紹介】{{projectTitle}}',
      engineerDraftBodyTemplate:
        props.ENGINEER_DRAFT_BODY_TEMPLATE ||
        '{{displayName}} 様\n\n以下の案件をご紹介します。\n\n案件名: {{projectTitle}}\n必須スキル: {{requiredSkills}}\n勤務地: {{locationText}}\n単価: {{rateMin}}〜{{rateMax}}\n開始時期: {{availabilityText}}\n',

      projectDraftSubjectTemplate:
        props.PROJECT_DRAFT_SUBJECT_TEMPLATE || '【ご提案】{{displayName}}様',
      projectDraftBodyTemplate:
        props.PROJECT_DRAFT_BODY_TEMPLATE ||
        'お世話になっております。\n\n以下の要員をご提案します。\n\n氏名: {{displayName}}\nスキル: {{skillsCsv}}\n勤務地: {{locationText}}\n稼働: {{availabilityText}}\n希望単価: {{rateMin}}〜{{rateMax}}\n',

      // AIあり前提。ただし将来の差し替え余地は残す。
      extractorPipeline: (props.EXTRACTOR_PIPELINE || 'regex,ai')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x),

      ai: {
        provider: this.require(props, 'AI_PROVIDER'),
        apiUrl: this.require(props, 'AI_API_URL'),
        apiKey: this.require(props, 'AI_API_KEY'),
        model: this.require(props, 'AI_MODEL')
      },

      keywords: {
        engineer: (props.ENGINEER_KEYWORDS || '要員,人材,技術者,エンジニア').split(','),
        project: (props.PROJECT_KEYWORDS || '案件,募集,ポジション,業務内容').split(',')
      }
    };

    this.validate(config);
    return config;
  },

  validate(config) {
    if (!config.extractorPipeline.includes('ai')) {
      throw new Error('AIあり実装では EXTRACTOR_PIPELINE に ai を含める必要があります。例: regex,ai');
    }

    if (config.ai.provider === 'none') {
      throw new Error('AIあり実装では AI_PROVIDER=none は使えません。');
    }

    if (!config.ai.apiUrl) {
      throw new Error('AIあり実装では AI_API_URL が必須です。');
    }

    if (!config.ai.apiKey) {
      throw new Error('AIあり実装では AI_API_KEY が必須です。');
    }

    if (!config.ai.model) {
      throw new Error('AIあり実装では AI_MODEL が必須です。');
    }
  },

  require(props, key) {
    const value = props[key];
    if (!value) throw new Error(`Script Property is required: ${key}`);
    return value;
  },

  toInt(value, defaultValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  },

  allowedPollMinutes(value) {
    const allowed = [1, 5, 10, 15, 30];
    return allowed.includes(value) ? value : 5;
  }
};