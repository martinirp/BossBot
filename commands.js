import fs from 'fs';
import path from 'path';

// ─── In-memory TTL Cache ─────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _cache = {};

function cachedRead(key, filePath) {
  const now = Date.now();
  if (_cache[key] && now - _cache[key].ts < CACHE_TTL_MS) {
    return _cache[key].data;
  }
  try {
    const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
    const data = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1'));
    _cache[key] = { data, ts: now };
    return data;
  } catch (err) {
    console.error(`[cache] Error reading ${filePath}:`, err);
    return _cache[key]?.data ?? null;
  }
}

export function normalizeBossName(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents/diacritics
    .replace(/[.'`´]/g, '')          // Remove dots and apostrophes (Mr. Punish → mr punish, Gaz'haragoth → gazharagoth)
    .replace(/\s+/g, ' ');           // Collapse multiple spaces
}

export function loadBosses() {
  const cached = cachedRead('bosses', 'bosses.json');
  if (cached) return cached;
  // Fallback: create default file if missing
  const defaultBosses = [
    "Ferumbras", "Ghazbaran", "Morgaroth", "Orshabaal", "Zushuka",
    "Chayenne", "Shlorg", "Munster", "Onyx", "Grand Mother Reapers"
  ];
  try {
    fs.writeFileSync(path.resolve('bosses.json'), JSON.stringify(defaultBosses, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to create default bosses.json:', e);
  }
  return defaultBosses;
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
  "rotworm queen": ["Edron", "Darashia", "Liberty Bay", "Ab'Dendriel"],
  "the voice of ruin": ["Ghastly Dragons", "Lizard Chosens"],
  "flamecaller zazrak": ["Surface", "+1 North"],
  "tyrn": ["Drefia", "Liberty Bay"],
  "dreadmaw": ["Esquerda", "Direita"],
  "white pale": ["Edron", "Darashia", "Liberty Bay"],
  "hirintror": ["Formorgar Mines", "Nibelor"],
  "battlemaster zunzu": ["Esquerda", "Direita"],
  "fleabringer": ["North", "Sul", "Surface"],
  "albino dragon": ["Dragon Lair (Ankrahmun)", "Dragon Lair (Farmine)", "Dragon Lair (Fenrock)", "Dragon Lair (Goroma)", "Pits of Inferno"]
};

export const CITY_ALIASES = {
  "dara": "Darashia",
  "lb": "Liberty Bay",
  "ab": "Ab'Dendriel",
  "ab'dendriel": "Hellgate (Ab'Dendriel)",
  "hellgate": "Hellgate (Ab'Dendriel)",
  "yala": "Yalahar",
  "esq": "Esquerda",
  "e": "Esquerda",
  "west": "Esquerda",
  "w": "Esquerda",
  "oeste": "Esquerda",
  "dir": "Direita",
  "d": "Direita",
  "east": "Direita",
  "leste": "Direita",
  "ghastly": "Ghastly Dragons",
  "chosen": "Lizard Chosens",
  "surf": "Surface",
  "s": "Surface",
  "norte": "+1 North",
  "north": "+1 North",
  "n": "+1 North",
  "drefia": "Drefia",
  "mines": "Formorgar Mines",
  "nibelor": "Nibelor",
  "sul": "Sul",
  "south": "Sul",
  "farmine": "Dragon Lair (Farmine)",
  "fenrock": "Dragon Lair (Fenrock)",
  "goroma": "Dragon Lair (Goroma)",
  "poi": "Pits of Inferno",
  "ank": "Dragon Lair (Ankrahmun)"
};

export function getBossCities(bossName) {
  if (!bossName) return null;
  const normalized = normalizeBossName(bossName);
  return MULTI_CITY_BOSSES[normalized] || null;
}

export function loadLocations() {
  return cachedRead('locations', 'boss_locations.json') ?? {};
}

export function getLinkForCity(bossName, locations, city) {
  const normCity = city.toLowerCase();
  for (const loc of locations) {
    const desc = loc.description.toLowerCase();

    if (normCity === 'ank' && (desc.includes('ankrahmun') || desc.includes('ank'))) return loc.link;
    if (normCity === 'poi' && (desc.includes('pits of inferno') || desc.includes('poi'))) return loc.link;
    if (normCity === 'lb' && (desc.includes('liberty bay') || desc.includes('lb'))) return loc.link;
    if (normCity === 'dara' && (desc.includes('darashia') || desc.includes('dara'))) return loc.link;
    if (normCity === 'ab' && (desc.includes("ab'dendriel") || desc.includes('ab'))) return loc.link;
    if (normCity === 'yala' && (desc.includes('yalahar') || desc.includes('yala'))) return loc.link;

    if (desc.includes(normCity)) {
      return loc.link;
    }
  }

  const cities = MULTI_CITY_BOSSES[bossName.toLowerCase()];
  if (cities) {
    const cityIndex = cities.findIndex(c => c.toLowerCase() === normCity);
    if (cityIndex !== -1 && locations[cityIndex]) {
      return locations[cityIndex].link;
    }
  }

  if (locations.length === 1) return locations[0].link;
  return null;
}
