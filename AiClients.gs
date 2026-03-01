// AIプロバイダごとのAPI呼び出しと抽出結果取得のアダプタを担う。

const AiClientFactory = {
  create(config) {
    if (config.ai.provider === 'openai_compatible') {
      return OpenAiCompatibleClient;
    }

    throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  }
};

const OpenAiCompatibleClient = {
  extractFields(config, input) {
    const payload = {
      model: config.ai.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You extract structured information from SES staffing emails.',
            'Return JSON only.',
            'Required top-level keys: entityType, confidence, rawFields, warnings.',
            'entityType must be one of: engineer, project, unknown.',
            'rawFields may contain only these keys:',
            'displayName, primaryEmail, skills, requiredSkills, niceToHaveSkills, locationText, nearestStation, rateMin, rateMax, availabilityText, remoteType, clientName.',
            'If an existing field already has a non-empty value, do not overwrite it unless the email clearly provides a more reliable value.',
            'Prefer filling missing fields over rewriting existing fields.',
            'confidence must be a number between 0 and 1.'
          ].join(' ')
        },
        {
          role: 'user',
          content: JSON.stringify({
            subject: input.subject || '',
            fromAddress: input.fromAddress || '',
            existingFields: input.existingFields || {},
            body: input.body || ''
          })
        }
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

    return {
      entityType: parsed.entityType || 'unknown',
      extractorName: 'openai_compatible',
      extractorVersion: '2.0.0',
      confidence: Number(parsed.confidence || 0.5),
      rawFields: parsed.rawFields || {},
      warnings: parsed.warnings || []
    };
  }
};