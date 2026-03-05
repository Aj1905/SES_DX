// 文字列整形・JSON処理・抽出補助などの共通ユーティリティを担う。

const Utils = {
  uuid() {
    return Utilities.getUuid();
  },

  nowIso() {
    return new Date().toISOString();
  },

  safeJsonStringify(value) {
    return JSON.stringify(value || {}, null, 2);
  },

  safeJsonParse(text, defaultValue) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return defaultValue;
    }
  },

  normalizeBody(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  },

  extractEmail(text) {
    const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].trim() : '';
  },

  extractMoneyValues(text) {
    const matches = String(text || '').match(/(\d{2,3})\s*(?:万|万円)/g) || [];
    return matches
      .map((x) => Number(x.replace(/[^\d]/g, '')))
      .filter((x) => Number.isFinite(x));
  },

  extractRateMin(text) {
    const values = this.extractMoneyValues(text);
    return values.length ? Math.min.apply(null, values) : '';
  },

  extractRateMax(text) {
    const values = this.extractMoneyValues(text);
    return values.length ? Math.max.apply(null, values) : '';
  },

  extractRemoteType(text) {
    const source = String(text || '');
    if (/フルリモート|完全在宅/i.test(source)) return 'full_remote';
    if (/リモート併用|ハイブリッド/i.test(source)) return 'hybrid';
    if (/常駐/i.test(source)) return 'onsite';
    return '';
  },

  extractFirst(text, patterns) {
    for (const pattern of patterns) {
      const match = String(text || '').match(pattern);
      if (!match) continue;
      if (match[1]) return String(match[1]).trim();
      if (match[0]) return String(match[0]).trim();
    }
    return '';
  },

  renderTemplate(template, vars) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : '';
    });
  },

  toSkillArray(value) {
    return String(value || '')
      .split(/[,、\/\n\r\t|]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x);
  },

  intersection(a, b) {
    const bSet = new Set(b);
    return a.filter((x) => bSet.has(x));
  },

  looseIncludes(a, b) {
    const left = String(a || '').toLowerCase();
    const right = String(b || '').toLowerCase();
    return left.includes(right) || right.includes(left);
  }
};