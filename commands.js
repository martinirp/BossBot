import fs from 'fs';
import path from 'path';

export function normalizeBossName(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Removes accents/diacritics
    .replace(/\s+/g, ' '); // Collapse multiple spaces to a single space
}

export function loadBosses() {
  const filePath = path.resolve('bosses.json');
  if (!fs.existsSync(filePath)) {
    const defaultBosses = [
      "Ferumbras", "Ghazbaran", "Morgaroth", "Orshabaal", "Zushuka", 
      "Chayenne", "Shlorg", "Munster", "Onyx", "Grand Mother Reapers"
    ];
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultBosses, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to create default bosses.json:', e);
    }
    return defaultBosses;
  }
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const cleanContent = fileContent.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(cleanContent);
  } catch (err) {
    console.error('Error loading bosses.json, using defaults:', err);
    return ["Ferumbras", "Ghazbaran", "Morgaroth", "Orshabaal", "Zushuka", "Munster"];
  }
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
  if (input && /^\d+$/.test(input.trim())) {
    const parsedNum = parseInt(input.trim(), 10);
    if (parsedNum >= 1 && parsedNum <= bossesList.length) {
      return { match: bossesList[parsedNum - 1], suggestions: [] };
    }
  }

  const normalizedInput = normalizeBossName(input);
  if (!normalizedInput) {
    return { match: null, suggestions: [] };
  }

  const mappedBosses = bossesList.map(original => ({
    original,
    normalized: normalizeBossName(original)
  }));

  const exact = mappedBosses.find(b => b.normalized === normalizedInput);
  if (exact) {
    return { match: exact.original, suggestions: [] };
  }

  const partials = mappedBosses.filter(b => b.normalized.includes(normalizedInput));
  if (partials.length === 1) {
    return { match: partials[0].original, suggestions: [] };
  } else if (partials.length > 1) {
    return { match: null, suggestions: partials.map(b => b.original) };
  }

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

export const MULTI_CITY_BOSSES = {
  "oculta": ["Yalahar", "Venore", "Ankrahmun"],
  "rotworm queen": ["Ab'Dendriel", "Darashia", "Edron", "Liberty Bay"]
};

export const CITY_ALIASES = {
  "dara": "Darashia",
  "lb": "Liberty Bay",
  "ab": "Ab'Dendriel",
  "yala": "Yalahar",
  "ank": "Ankrahmun"
};

export function getBossCities(bossName) {
  if (!bossName) return null;
  const normalized = normalizeBossName(bossName);
  return MULTI_CITY_BOSSES[normalized] || null;
}
