// メールからの情報抽出パイプラインを担う。

// ===== 抽出モード選択 =====
// 'ai_full' : AI丸投げモード — 分類・抽出を全てAIで行う
// 'hybrid'  : アルゴリズム併用モード — 可能な限りアルゴリズムで行い、残りをAIで補填
const EXTRACTION_MODE = 'ai_full';

// ===== 1. 除去する記号リスト =====
const STRIP_CHARS = ':[]{}!@#$%^&*()_+=|\\<>?/~`"\'';

// ===== 2. 除去する定型文リスト =====
const STRIP_PHRASES = [
  'お世話になっております',
  'お世話になります',
  'お疲れ様です',
  'お疲れ様でございます',
  'いつもお世話になっております',
  'いつも大変お世話になっております',
  'よろしくお願いいたします',
  'よろしくお願い致します',
  'よろしくお願いします',
  '以上、よろしくお願いいたします',
  '以上よろしくお願いいたします',
  'ご確認よろしくお願いいたします',
  'ご確認のほどよろしくお願いいたします',
  '何卒よろしくお願いいたします',
  'ご検討よろしくお願いいたします',
  '以下ご確認ください',
  '突然のご連絡失礼いたします'
];

// ===== 3. 人材メール取得情報リスト =====
const ENGINEER_FIELDS = [
  'displayName',
  'primaryEmail',
  'skills',
  'locationText',
  'nearestStation',
  'rateMin',
  'rateMax',
  'availabilityText',
  'remoteType'
];

// ===== 4. 案件メール取得情報リスト =====
const PROJECT_FIELDS = [
  'displayName',
  'primaryEmail',
  'requiredSkills',
  'niceToHaveSkills',
  'locationText',
  'nearestStation',
  'rateMin',
  'rateMax',
  'availabilityText',
  'remoteType',
  'clientName'
];

// ===== 分類用プロンプト =====
const CLASSIFY_PROMPT = [
  'You classify SES (System Engineering Service) staffing emails written in Japanese.',
  'You will receive ONLY the email subject line.',
  'Determine whether the email is about an engineer (人材/要員) or a project (案件).',
  'Engineer email: about a person, their skills, experience, availability.',
  'Project email: about a project, required skills, budget, work conditions.',
  'Return JSON only: {"entityType": "engineer"} or {"entityType": "project"}.',
  'If you cannot determine, return {"entityType": "unknown"}.'
].join(' ');

// ===== テキスト前処理 =====
const TextCleaner = {
  clean(subject, body) {
    const combined = (subject || '') + '\n' + (body || '');

    // 記号除去
    const stripSet = new Set(STRIP_CHARS.split(''));
    let text = combined
      .split('')
      .filter(function(ch) { return !stripSet.has(ch); })
      .join('');

    // 定型文除去
    for (let i = 0; i < STRIP_PHRASES.length; i++) {
      text = text.split(STRIP_PHRASES[i]).join('');
    }

    // 連続空白を1つに潰す
    return text.replace(/\s+/g, ' ').trim();
  }
};

// ===== パイプライン（外部から呼ばれるインターフェース） =====
const ExtractionPipeline = {
  run(config, rawRecord) {
    if (EXTRACTION_MODE === 'ai_full') {
      return AiFullMode.run(config, rawRecord);
    }
    return HybridMode.run(config, rawRecord);
  }
};

// ===== AI丸投げモード =====
const AiFullMode = {
  run(config, rawRecord) {
    const aiClient = AiClientFactory.create(config);

    // [1] タイトルだけをAIに投げて人材/案件を分類
    const entityType = this.classify(aiClient, config, rawRecord.subject);

    // タイトル+本文を結合 → 記号・定型文除去 → 空白潰し
    const cleanedText = TextCleaner.clean(rawRecord.subject, rawRecord.normalized_body);

    // [2] クリーニング済みテキストをAIに投げてフィールド抽出
    const fieldList = entityType === 'engineer' ? ENGINEER_FIELDS : PROJECT_FIELDS;
    const result = this.extractFields(aiClient, config, cleanedText, entityType, fieldList);

    return {
      entityType,
      extractorName: 'ai_full',
      extractorVersion: '1.0.0',
      confidence: Number(result.confidence || 0.8),
      rawFields: result.rawFields || {},
      warnings: result.warnings || []
    };
  },

  classify(aiClient, config, subject) {
    const result = aiClient.ask(config, CLASSIFY_PROMPT, subject || '');
    const entityType = String(result.entityType || '').toLowerCase();

    if (entityType !== 'engineer' && entityType !== 'project') {
      throw new Error('AI丸投げモード: メールを人材/案件に分類できませんでした');
    }
    return entityType;
  },

  extractFields(aiClient, config, text, entityType, fieldList) {
    const prompt = [
      'You extract structured information from a Japanese SES staffing email.',
      'This email is about: ' + (entityType === 'engineer' ? '人材 (engineer)' : '案件 (project)') + '.',
      'Extract ONLY the following fields: ' + fieldList.join(', ') + '.',
      'Return JSON only: {"rawFields": {field: value}, "confidence": 0-1, "warnings": []}.',
      'Use empty string for fields not found in the text.'
    ].join(' ');

    return aiClient.ask(config, prompt, text);
  }
};

// ===== アルゴリズム併用モード =====
const HybridMode = {
  run(config, rawRecord) {
    const aiClient = AiClientFactory.create(config);

    // [1] アルゴリズムで分類を試みる → 決まらなければAIにフォールバック
    let entityType = this.classifyByAlgorithm(config, rawRecord.subject);

    if (entityType === 'unknown') {
      entityType = AiFullMode.classify(aiClient, config, rawRecord.subject);
    }

    // タイトル+本文を結合 → 記号・定型文除去 → 空白潰し
    const cleanedText = TextCleaner.clean(rawRecord.subject, rawRecord.normalized_body);
    const fieldList = entityType === 'engineer' ? ENGINEER_FIELDS : PROJECT_FIELDS;

    // [2] アルゴリズムでフィールド抽出を試みる
    const algoFields = this.extractByAlgorithm(config, cleanedText, entityType, fieldList);

    // アルゴリズムで取れなかったフィールドをAIで補填
    const missingFields = fieldList.filter(function(f) {
      return !algoFields[f] || String(algoFields[f]).trim() === '';
    });

    let aiFields = {};
    if (missingFields.length > 0) {
      const aiResult = AiFullMode.extractFields(aiClient, config, cleanedText, entityType, missingFields);
      aiFields = aiResult.rawFields || {};
    }

    // マージ: アルゴリズム結果を優先、不足分をAIで埋める
    const rawFields = {};
    fieldList.forEach(function(f) {
      rawFields[f] = algoFields[f] || aiFields[f] || '';
    });

    return {
      entityType,
      extractorName: 'hybrid',
      extractorVersion: '1.0.0',
      confidence: missingFields.length === 0 ? 0.9 : 0.8,
      rawFields: rawFields,
      warnings: []
    };
  },

  // --- [1] 分類アルゴリズム（TODO: 実装） ---
  classifyByAlgorithm(config, subject) {
    // ここにアルゴリズムを実装する
    // 'engineer' / 'project' / 'unknown' を返す
    return 'unknown';
  },

  // --- [2] フィールド抽出アルゴリズム（TODO: 実装） ---
  extractByAlgorithm(config, text, entityType, fieldList) {
    // ここにアルゴリズムを実装する
    // { fieldName: value, ... } を返す（取得できなかったフィールドは含めなくてよい）
    return {};
  }
};
