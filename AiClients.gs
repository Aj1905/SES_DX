// AIプロバイダごとのAPI呼び出しアダプタを担う。

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

const GeminiClient = {
  ask(config, systemPrompt, userContent) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.model}:generateContent?key=${config.ai.apiKey}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userContent }]
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
    return Utils.safeJsonParse(text, {});
  }
};

const OpenAiCompatibleClient = {
  ask(config, systemPrompt, userContent) {
    const payload = {
      model: config.ai.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
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
    return Utils.safeJsonParse(content, {});
  }
};
