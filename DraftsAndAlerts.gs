// マッチ結果に基づくメール下書き作成とエラー通知送信を担う。

const DraftService = {
  createDrafts(config, sourceNormalizedRecord, candidates) {
    const created = [];
    const topCandidates = candidates.slice(0, config.maxDraftsPerItem);
    const sourceJson = Utils.safeJsonParse(sourceNormalizedRecord.normalized_json, {});

    for (const candidateInfo of topCandidates) {
      const target = candidateInfo.target;
      const targetJson = Utils.safeJsonParse(target.normalized_json, {});

      let to = '';
      let subject = '';
      let body = '';

      if (sourceNormalizedRecord.entity_type === 'project') {
        to = target.primary_email || targetJson.primaryEmail || '';
        if (!to) continue;

        subject = Utils.renderTemplate(config.engineerDraftSubjectTemplate, {
          displayName: target.display_name || targetJson.displayName || '',
          projectTitle: sourceNormalizedRecord.display_name || sourceJson.displayName || '',
          requiredSkills: sourceJson.requiredSkills || sourceNormalizedRecord.skills_csv || '',
          locationText: sourceNormalizedRecord.location_text || '',
          rateMin: sourceNormalizedRecord.rate_min || '',
          rateMax: sourceNormalizedRecord.rate_max || '',
          availabilityText: sourceNormalizedRecord.availability_text || ''
        });

        body = Utils.renderTemplate(config.engineerDraftBodyTemplate, {
          displayName: target.display_name || targetJson.displayName || '',
          projectTitle: sourceNormalizedRecord.display_name || sourceJson.displayName || '',
          requiredSkills: sourceJson.requiredSkills || sourceNormalizedRecord.skills_csv || '',
          locationText: sourceNormalizedRecord.location_text || '',
          rateMin: sourceNormalizedRecord.rate_min || '',
          rateMax: sourceNormalizedRecord.rate_max || '',
          availabilityText: sourceNormalizedRecord.availability_text || ''
        });
      } else {
        to = target.primary_email || targetJson.primaryEmail || '';
        if (!to) continue;

        subject = Utils.renderTemplate(config.projectDraftSubjectTemplate, {
          displayName: sourceNormalizedRecord.display_name || sourceJson.displayName || ''
        });

        body = Utils.renderTemplate(config.projectDraftBodyTemplate, {
          displayName: sourceNormalizedRecord.display_name || sourceJson.displayName || '',
          skillsCsv: sourceNormalizedRecord.skills_csv || sourceJson.skillsCsv || '',
          locationText: sourceNormalizedRecord.location_text || '',
          availabilityText: sourceNormalizedRecord.availability_text || '',
          rateMin: sourceNormalizedRecord.rate_min || '',
          rateMax: sourceNormalizedRecord.rate_max || ''
        });
      }

      GmailApp.createDraft(to, subject, body, {
        name: config.draftSenderName
      });

      created.push({
        targetNormalizedId: target.normalized_id,
        draftTo: to,
        draftSubject: subject
      });
    }

    return created;
  }
};

const AlertService = {
  notifyError(config, message, error) {
    GmailApp.sendEmail(
      config.managerAlertEmail,
      '[SES Matcher] 処理失敗',
      [
        'SES Matcher の処理でエラーが発生しました。',
        '',
        `subject: ${message.getSubject()}`,
        `from: ${message.getFrom()}`,
        `messageId: ${message.getId()}`,
        `threadId: ${message.getThread().getId()}`,
        '',
        `error: ${error.message || String(error)}`
      ].join('\n')
    );
  }
};