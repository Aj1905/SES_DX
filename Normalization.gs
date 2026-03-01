// 抽出された中間データを扱いやすい正規化形式へ変換する処理を担う。

const EntityNormalizer = {
  normalize(parsedResult, rawRecord) {
    const entityType = parsedResult.entityType || 'unknown';
    const fields = parsedResult.rawFields || {};

    const normalized = {
      displayName: fields.displayName || rawRecord.subject || '',
      primaryEmail: fields.primaryEmail || Utils.extractEmail(rawRecord.from_address) || '',
      skillsCsv: entityType === 'project'
        ? (fields.requiredSkills || '')
        : (fields.skills || ''),
      locationText: fields.locationText || '',
      rateMin: fields.rateMin || '',
      rateMax: fields.rateMax || '',
      availabilityText: fields.availabilityText || '',
      remoteType: fields.remoteType || '',
      nearestStation: fields.nearestStation || '',
      requiredSkills: fields.requiredSkills || '',
      niceToHaveSkills: fields.niceToHaveSkills || '',
      clientName: fields.clientName || '',
      rawFields: fields
    };

    return {
      entityType,
      displayName: normalized.displayName,
      primaryEmail: normalized.primaryEmail,
      skillsCsv: normalized.skillsCsv,
      locationText: normalized.locationText,
      rateMin: normalized.rateMin,
      rateMax: normalized.rateMax,
      availabilityText: normalized.availabilityText,
      remoteType: normalized.remoteType,
      normalizedJson: {
        entityType,
        displayName: normalized.displayName,
        primaryEmail: normalized.primaryEmail,
        skillsCsv: normalized.skillsCsv,
        locationText: normalized.locationText,
        rateMin: normalized.rateMin,
        rateMax: normalized.rateMax,
        availabilityText: normalized.availabilityText,
        remoteType: normalized.remoteType,
        nearestStation: normalized.nearestStation,
        requiredSkills: normalized.requiredSkills,
        niceToHaveSkills: normalized.niceToHaveSkills,
        clientName: normalized.clientName,
        rawFields: normalized.rawFields
      }
    };
  }
};