// 正規化済みデータ同士のマッチング候補算出とスコアリングを担う。

const MatcherService = {
  findCandidates(config, sourceNormalizedRecord) {
    const sourceEntityType = sourceNormalizedRecord.entity_type;
    const sourceId = String(sourceNormalizedRecord.normalized_id);

    if (sourceEntityType === 'project') {
      const engineers = NormalizedEntityRepository.listByEntityType(config, 'engineer');
      return engineers
        .filter((e) => String(e.normalized_id) !== sourceId)
        .map((engineer) => this.score(sourceNormalizedRecord, engineer))
        .filter((x) => x.score >= config.matchThreshold)
        .sort((a, b) => b.score - a.score);
    }

    if (sourceEntityType === 'engineer') {
      const projects = NormalizedEntityRepository.listByEntityType(config, 'project');
      return projects
        .filter((p) => String(p.normalized_id) !== sourceId)
        .map((project) => this.score(sourceNormalizedRecord, project))
        .filter((x) => x.score >= config.matchThreshold)
        .sort((a, b) => b.score - a.score);
    }

    return [];
  },

  score(source, target) {
    const sourceJson = Utils.safeJsonParse(source.normalized_json, {});
    const targetJson = Utils.safeJsonParse(target.normalized_json, {});
    let score = 0;
    const reasons = [];

    const sourceSkills = Utils.toSkillArray(sourceJson.skillsCsv || sourceJson.requiredSkills || '');
    const targetSkills = Utils.toSkillArray(targetJson.skillsCsv || targetJson.requiredSkills || '');
    const overlap = Utils.intersection(sourceSkills, targetSkills);

    score += overlap.length * 15;
    if (overlap.length) reasons.push(`skill:${overlap.join('/')}`);

    if (source.remote_type && target.remote_type && source.remote_type === target.remote_type) {
      score += 10;
      reasons.push(`remote:${source.remote_type}`);
    }

    if (source.location_text && target.location_text && Utils.looseIncludes(source.location_text, target.location_text)) {
      score += 10;
      reasons.push(`location:${source.location_text}`);
    }

    const sourceMin = Number(source.rate_min || 0);
    const sourceMax = Number(source.rate_max || 0);
    const targetMin = Number(target.rate_min || 0);
    const targetMax = Number(target.rate_max || 0);

    if (sourceMin && targetMax && sourceMin <= targetMax) {
      score += 10;
      reasons.push('rate_ok');
    }

    if (sourceMax && targetMin && sourceMax >= targetMin) {
      score += 10;
      reasons.push('rate_overlap');
    }

    return {
      target,
      score,
      reason: reasons.join(', ')
    };
  }
};