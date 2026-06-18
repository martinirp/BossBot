export function normalizeBossName(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Removes accents/diacritics
    .replace(/\s+/g, ' '); // Collapse multiple spaces to a single space
}

const RESERVED_WORDS = new Set(['remover', 'confirmar', 'meusbosses', 'bosses', 'enquete', 'help', 'ajuda', 'c', 'reset', 'limpar', 'limparbosses']);

export function parseMessage(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('!')) return null;

  const lowerTrimmed = trimmed.toLowerCase();

  // 1. !help ou !ajuda
  if (lowerTrimmed === '!help' || lowerTrimmed === '!ajuda') {
    return { type: 'help' };
  }

  // 1.8. !reset
  if (lowerTrimmed === '!reset') {
    return { type: 'reset' };
  }

  // 2. !meusbosses
  if (lowerTrimmed === '!meusbosses') {
    return { type: 'list' };
  }

  // 2.5. !limparbosses (clears all)
  if (lowerTrimmed === '!limparbosses') {
    return { type: 'clear' };
  }

  // 2.6. !limpar (no arguments - clear_help)
  if (lowerTrimmed === '!limpar') {
    return { type: 'clear_help' };
  }

  // 3. !bosses <arg>
  if (lowerTrimmed === '!bosses') {
    return { type: 'bosses_menu', arg: null };
  }
  if (lowerTrimmed.startsWith('!bosses ')) {
    const prefixLen = 8;
    const arg = trimmed.substring(prefixLen).trim().toLowerCase();
    return { type: 'bosses_menu', arg: arg || null };
  }

  // 4. !remover <boss> ou !limpar <boss> (removes one boss)
  if (lowerTrimmed.startsWith('!remover ') || lowerTrimmed.startsWith('!limpar ')) {
    const prefixLen = lowerTrimmed.startsWith('!remover ') ? 9 : 8;
    const bossRaw = trimmed.substring(prefixLen);
    const bossName = normalizeBossName(bossRaw);
    if (!bossName || RESERVED_WORDS.has(bossName)) return null;
    return { type: 'remove', bossName };
  }

  // 5. !confirmar <boss> [ | ou , extra text] ou !c <boss> [ | ou , extra text]
  if (lowerTrimmed.startsWith('!confirmar ') || lowerTrimmed.startsWith('!c ')) {
    const prefixLen = lowerTrimmed.startsWith('!confirmar ') ? 11 : 3;
    const rest = trimmed.substring(prefixLen).trim();
    if (!rest) return null;

    let bossRaw = rest;
    let extraText = '';

    const commaIndex = rest.indexOf(',');
    const pipeIndex = rest.indexOf('|');
    let separatorIndex = -1;
    if (commaIndex !== -1 && pipeIndex !== -1) {
      separatorIndex = Math.min(commaIndex, pipeIndex);
    } else {
      separatorIndex = commaIndex !== -1 ? commaIndex : pipeIndex;
    }

    if (separatorIndex !== -1) {
      bossRaw = rest.substring(0, separatorIndex).trim();
      extraText = rest.substring(separatorIndex + 1).trim();
    }

    const bossName = normalizeBossName(bossRaw);
    if (!bossName || RESERVED_WORDS.has(bossName)) return null;
    return { type: 'confirm', bossName, extraText };
  }

  // 6. !<boss> (can have spaces, e.g. !man in the cave)
  const bossRaw = trimmed.substring(1).trim();
  const bossName = normalizeBossName(bossRaw);
  if (!bossName || RESERVED_WORDS.has(bossName)) return null;
  return { type: 'subscribe', bossName };
}

export function getLevenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function findBossMatch(input, bossesList) {
  const normalizedInput = normalizeBossName(input);
  if (!normalizedInput) {
    return { match: null, suggestions: [] };
  }

  // Map each original boss name to its normalized version
  const mappedBosses = bossesList.map(original => ({
    original,
    normalized: normalizeBossName(original)
  }));

  // 1. Exact match
  const exact = mappedBosses.find(b => b.normalized === normalizedInput);
  if (exact) {
    return { match: exact.original, suggestions: [] };
  }

  // 2. Prefix / Substring match
  const partials = mappedBosses.filter(b => b.normalized.includes(normalizedInput));
  if (partials.length === 1) {
    return { match: partials[0].original, suggestions: [] };
  } else if (partials.length > 1) {
    return { match: null, suggestions: partials.map(b => b.original) };
  }

  // 3. Edit distance (Levenshtein)
  const distances = mappedBosses.map(b => ({
    boss: b,
    distance: getLevenshteinDistance(normalizedInput, b.normalized)
  }));

  const threshold = 2; // maximum edit distance
  const candidates = distances.filter(d => d.distance <= threshold);

  if (candidates.length === 1) {
    return { match: candidates[0].boss.original, suggestions: [] };
  } else if (candidates.length > 1) {
    candidates.sort((a, b) => a.distance - b.distance);
    return { match: null, suggestions: candidates.map(c => c.boss.original) };
  }

  return { match: null, suggestions: [] };
}
