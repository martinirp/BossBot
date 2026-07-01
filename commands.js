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
  "rotworm queen": ["Ab'Dendriel", "Darashia", "Edron", "Liberty Bay"],
  "the voice of ruin": ["Esquerda", "Direita"],
  "flamecaller zazrak": ["Surface", "North"],
  "tyrn": ["Liberty Bay", "Drefia"],
  "dreadmaw": ["West", "East"],
  "white pale": ["Edron", "Darashia", "Liberty Bay"],
  "hirintror": ["Mines", "Nibelor"],
  "battlemaster zunzu": ["West", "East"],
  "fleabringer": ["Surface", "North", "Sul"],
  "albino dragon": ["Farmine", "Fenrock", "Goroma", "POI", "Ank"],
  "danimax": ["Thais", "Carlin"]
};

export const CITY_ALIASES = {
  "dara": "Darashia",
  "lb": "Liberty Bay",
  "ab": "Ab'Dendriel",
  "yala": "Yalahar",
  "ank": "Ankrahmun",
  "esq": "Esquerda",
  "e": "Esquerda",
  "dir": "Direita",
  "d": "Direita",
  "surf": "Surface",
  "s": "Surface",
  "norte": "North",
  "n": "North",
  "drefia": "Drefia",
  "west": "West",
  "w": "West",
  "oeste": "West",
  "east": "East",
  "leste": "East",
  "mines": "Mines",
  "nibelor": "Nibelor",
  "sul": "Sul",
  "south": "Sul",
  "farmine": "Farmine",
  "fenrock": "Fenrock",
  "goroma": "Goroma",
  "poi": "POI"
};

export function getBossCities(bossName) {
  if (!bossName) return null;
  const normalized = normalizeBossName(bossName);
  return MULTI_CITY_BOSSES[normalized] || null;
}

export function loadLocations() {
  try {
    const jsonPath = path.resolve('boss_locations.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    return {};
  }
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
