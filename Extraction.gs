// 抽出器の切り替えとメール本文からの中間データ抽出パイプラインを担う。

const ExtractorRegistry = {
  createPipeline(config) {
    return config.extractorPipeline.map((name) => {
      if (name === 'regex') return RegexHeuristicExtractor;
      if (name === 'ai') return AiAssistedExtractor;
      throw new Error(`Unknown extractor: ${name}`);
    });
  }
};

const ExtractionPipeline = {
  run(config, rawRecord) {
    const extractors = ExtractorRegistry.createPipeline(config);

    const aggregate = {
      entityType: 'unknown',
      extractorName: 'pipeline',
      extractorVersion: '1.0.0',
      confidence: 0,
      rawFields: {},
      warnings: [],
      fieldSources: {}
    };

    for (const extractor of extractors) {
      const result = extractor.extract(config, rawRecord, aggregate);
      if (!result) continue;

      this.mergeResult(aggregate, result);
    }

    if (Object.keys(aggregate.rawFields).length === 0) {
      aggregate.warnings.push('No extractor produced usable fields');
    }

    return {
      entityType: aggregate.entityType,
      extractorName: aggregate.extractorName,
      extractorVersion: aggregate.extractorVersion,
      confidence: aggregate.confidence,
      rawFields: aggregate.rawFields,
      warnings: aggregate.warnings
    };
  },

  mergeResult(aggregate, result) {
    const resultConfidence = Number(result.confidence || 0);

    if (
      result.entityType &&
      result.entityType !== 'unknown' &&
      (
        aggregate.entityType === 'unknown' ||
        resultConfidence >= Number(aggregate.confidence || 0)
      )
    ) {
      aggregate.entityType = result.entityType;
      aggregate.extractorName = result.extractorName;
      aggregate.extractorVersion = result.extractorVersion;
      aggregate.confidence = resultConfidence;
    }

    const incomingFields = result.rawFields || {};
    Object.keys(incomingFields).forEach((key) => {
      const incomingValue = incomingFields[key];
      const currentValue = aggregate.rawFields[key];

      if (this.isMeaningful(incomingValue) && !this.isMeaningful(currentValue)) {
        aggregate.rawFields[key] = incomingValue;
        aggregate.fieldSources[key] = result.extractorName;
      }
    });

    if (result.warnings && result.warnings.length) {
      aggregate.warnings = aggregate.warnings.concat(result.warnings);
    }
  },

  isMeaningful(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== '';
  }
};

const RegexHeuristicExtractor = {
  extract(config, rawRecord) {
    const text = rawRecord.normalized_body;
    const entityType = Utils.classifyByKeywords(config, [rawRecord.subject, text].join('\n'));

    const fields = {
      displayName: Utils.extractFirst(text, [
        /(?:氏名|名前|Name)\s*[:：]\s*(.+)/i,
        /(?:案件名|件名|ポジション)\s*[:：]\s*(.+)/i,
        /【案件】\s*(.+)/i
      ]),
      primaryEmail: Utils.extractEmail(text) || Utils.extractEmail(rawRecord.from_address),
      skills: Utils.extractFirst(text, [
        /(?:スキル|技術|経験技術)\s*[:：]\s*([\s\S]{1,300})/i
      ]),
      locationText: Utils.extractFirst(text, [
        /(?:勤務地|居住地|場所)\s*[:：]\s*(.+)/i
      ]),
      nearestStation: Utils.extractFirst(text, [
        /(?:最寄駅)\s*[:：]\s*(.+)/i
      ]),
      rateMin: Utils.extractRateMin(text),
      rateMax: Utils.extractRateMax(text),
      availabilityText: Utils.extractFirst(text, [
        /(?:稼働|参画可能時期|開始時期|参画時期|期間)\s*[:：]\s*(.+)/i
      ]),
      remoteType: Utils.extractRemoteType(text),
      requiredSkills: Utils.extractFirst(text, [
        /(?:必須スキル|必須|必須経験)\s*[:：]\s*([\s\S]{1,300})/i
      ]),
      niceToHaveSkills: Utils.extractFirst(text, [
        /(?:尚可|歓迎スキル|尚可スキル)\s*[:：]\s*([\s\S]{1,300})/i
      ]),
      clientName: Utils.extractFirst(text, [
        /(?:顧客名|クライアント|エンド)\s*[:：]\s*(.+)/i
      ])
    };

    let confidence = 0.2;
    if (entityType !== 'unknown') confidence += 0.2;
    if (fields.displayName) confidence += 0.15;
    if (fields.primaryEmail) confidence += 0.1;
    if (fields.skills || fields.requiredSkills) confidence += 0.15;
    if (fields.locationText) confidence += 0.1;
    if (fields.rateMin || fields.rateMax) confidence += 0.1;
    if (fields.availabilityText) confidence += 0.1;

    return {
      entityType,
      extractorName: 'regex_heuristic',
      extractorVersion: '3.0.0',
      confidence: Math.min(confidence, 0.8),
      rawFields: fields,
      warnings: entityType === 'unknown'
        ? ['Entity type could not be classified by regex extractor']
        : []
    };
  }
};

const AiAssistedExtractor = {
  extract(config, rawRecord, aggregate) {
    const aiClient = AiClientFactory.create(config);

    const response = aiClient.extractFields(config, {
      subject: rawRecord.subject,
      body: rawRecord.normalized_body,
      fromAddress: rawRecord.from_address,
      existingFields: (aggregate && aggregate.rawFields) || {}
    });

    return {
      entityType: response.entityType || 'unknown',
      extractorName: response.extractorName || 'ai_assisted',
      extractorVersion: response.extractorVersion || '1.0.0',
      confidence: Number(response.confidence || 0),
      rawFields: response.rawFields || {},
      warnings: response.warnings || []
    };
  }
};