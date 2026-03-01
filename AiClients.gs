// AIプロバイダごとのAPI呼び出しと抽出結果取得のアダプタを担う。

const AiClientFactory = {
  create(config) {
    if (config.ai.provider === 'openai_compatible') {
      return OpenAiCompatibleClient;
    }
    if (config.ai.provider === 'gemini') {
      return GeminiClient;
    }

    throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  }
};

const SYSTEM_PROMPT = [
  'You extract structured information from SES staffing emails.',
  'Return JSON only.',
  'Required top-level keys: entityType, confidence, rawFields, warnings.',
  'entityType must be one of: engineer, project, unknown.',
  'rawFields may contain only these keys:',
  'displayName, primaryEmail, skills, requiredSkills, niceToHaveSkills, locationText, nearestStation, rateMin, rateMax, availabilityText, remoteType, clientName.',
  'If an existing field already has a non-empty value, do not overwrite it unless the email clearly provides a more reliable value.',
  'Prefer filling missing fields over rewriting existing fields.',
  'confidence must be a number between 0 and 1.'
].join(' ');

function buildUserContent(input) {
  return JSON.stringify({
    subject: input.subject || '',
    fromAddress: input.fromAddress || '',
    existingFields: input.existingFields || {},
    body: input.body || ''
  });
}

function parseAiResult(parsed, extractorName) {
  return {
    entityType: parsed.entityType || 'unknown',
    extractorName: extractorName,
    extractorVersion: '2.0.0',
    confidence: Number(parsed.confidence || 0.5),
    rawFields: parsed.rawFields || {},
    warnings: parsed.warnings || []
  };
}

const GeminiClient = {
  extractFields(config, input) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.model}:generateContent?key=${config.ai.apiKey}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildUserContent(input) }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error(`Gemini HTTP error: ${response.getResponseCode()} / ${response.getContentText()}`);
    }

    const responseJson = Utils.safeJsonParse(response.getContentText(), {});
    const content = (((responseJson.candidates || [])[0] || {}).content || {}).parts || [];
    const text = content.length > 0 ? content[0].text || '{}' : '{}';
    const parsed = Utils.safeJsonParse(text, {});

    return parseAiResult(parsed, 'gemini');
  }
};

const OpenAiCompatibleClient = {
  extractFields(config, input) {
    const payload = {
      model: config.ai.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(input) }
      ]
    };

    const response = UrlFetchApp.fetch(config.ai.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error(`AI HTTP error: ${response.getResponseCode()} / ${response.getContentText()}`);
    }

    const responseJson = Utils.safeJsonParse(response.getContentText(), {});
    const content = (((responseJson.choices || [])[0] || {}).message || {}).content || '{}';
    const parsed = Utils.safeJsonParse(content, {});

    return parseAiResult(parsed, 'openai_compatible');
  }
};