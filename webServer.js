import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  db, 
  getAllBossesLastSeen, 
  getBossLastSeen, 
  getBossCheck, 
  getUserName,
  parseDateStr,
  utcToGerman,
  germanToUtc,
  utcToBrt
} from './database.js';
import { syncWorldKillStatistics } from './syncTibiaData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static dashboard page
app.use(express.static(path.join(__dirname, 'public')));
// Serve boss animated sprites
app.use('/assets/bosses', express.static(path.join(__dirname, 'assets', 'bosses')));

const PORT = 8080;

const MULTI_CITY_BOSSES = {
  "rotworm queen": ["Ab'Dendriel", "Darashia", "Edron", "Liberty Bay"],
  "the voice of ruin": ["Esquerda", "Direita"],
  "flamecaller zazrak": ["Surface", "North"],
  "tyrn": ["Liberty Bay", "Drefia"],
  "dreadmaw": ["West", "East"],
  "white pale": ["Edron", "Darashia", "Liberty Bay"],
  "hirintror": ["Mines", "Nibelor"],
  "battlemaster zunzu": ["West", "East"],
  "fleabringer": ["Surface", "North", "Sul"],
  "albino dragon": ["Farmine", "Fenrock", "Goroma", "POI", "Ank"]
};

// Compile monitored bosses list
const rawBosses = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
const monitoredBosses = [];
for (const boss of rawBosses) {
  const key = boss.toLowerCase();
  if (MULTI_CITY_BOSSES[key]) {
    for (const city of MULTI_CITY_BOSSES[key]) {
      monitoredBosses.push(`${boss} (${city})`);
    }
  } else {
    monitoredBosses.push(boss);
  }
}

function getBossMapLink(bossNameWithCity, bossLocations) {
  const cityMatch = bossNameWithCity.match(/^(.+?)\s*\((.+?)\)$/);
  if (!cityMatch) {
    const locations = bossLocations[bossNameWithCity] || [];
    return locations[0]?.link || null;
  }
  
  const baseName = cityMatch[1].trim();
  const city = cityMatch[2].trim();
  
  const cities = MULTI_CITY_BOSSES[baseName.toLowerCase()];
  if (!cities) return null;
  
  const cityIndex = cities.indexOf(city);
  if (cityIndex === -1) return null;
  
  const locations = bossLocations[baseName] || [];
  return locations[cityIndex]?.link || null;
}

async function formatJidName(jid) {
  if (!jid) return 'Desconhecido';
  if (jid === 'TibiaData_API') return 'TibiaData API';
  if (jid === 'system_adjust') return 'Sistema';
  if (jid === 'flop') return 'Flop';
  
  try {
    const name = await getUserName(jid);
    if (name) return name;
  } catch (err) {
    console.error('[WebAPI] Erro ao obter nome para JID:', err);
  }
  
  if (jid.includes('@')) {
    return `@${jid.split('@')[0]}`;
  }
  return jid;
}

function getKillHistory(world, bossName) {
  return new Promise((resolve, reject) => {
    const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
    let query, params;
    if (cityMatch) {
      const baseName = cityMatch[1].trim();
      query = `SELECT boss_name, reported_by_jid, extra_text, created_at 
               FROM boss_reports 
               WHERE world = ? AND (boss_name = ? OR boss_name = ?) 
               ORDER BY created_at DESC`;
      params = [world, bossName, baseName];
    } else {
      query = `SELECT boss_name, reported_by_jid, extra_text, created_at 
               FROM boss_reports 
               WHERE world = ? AND boss_name = ? 
               ORDER BY created_at DESC`;
      params = [world, bossName];
    }

    db.all(query, params, async (err, rows) => {
      if (err) return reject(err);
      if (!rows) return resolve([]);
      
      const mapped = [];
      for (const row of rows) {
        const utcDate = new Date(row.created_at.replace(' ', 'T') + 'Z');
        const brtDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
        const kill_date = `${brtDate.getUTCFullYear()}-${String(brtDate.getUTCMonth() + 1).padStart(2, '0')}-${String(brtDate.getUTCDate()).padStart(2, '0')}`;
        
        const confirmed_by = await formatJidName(row.reported_by_jid);
        mapped.push({
          kill_date,
          amount_killed: 1,
          confirmed_by,
          extra_text: row.extra_text,
          created_at: row.created_at
        });
      }
      resolve(mapped);
    });
  });
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json({
    defaultWorld: process.env.TIBIA_WORLD || 'Quelibra',
    port: PORT
  });
});

app.post('/api/fetch/:world', async (req, res) => {
  const world = req.params.world;
  res.json({ message: `Coleta iniciada para o mundo ${world}...` });
  try {
    await syncWorldKillStatistics(world);
  } catch (err) {
    console.error(`[WebAPI] Erro ao sincronizar manualmente o mundo ${world}:`, err);
  }
});

app.get('/api/bosses/:world', async (req, res) => {
  const world = req.params.world;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const yesterdayDate = new Date();
  yesterdayDate.setUTCHours(yesterdayDate.getUTCHours() - 3);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getUTCDate()).padStart(2, '0')}`;

  try {
    const bossIntervals = JSON.parse(fs.readFileSync(path.resolve('boss_intervals.json'), 'utf8'));
    const bossLocations = JSON.parse(fs.readFileSync(path.resolve('boss_locations.json'), 'utf8'));
    const bossStats = JSON.parse(fs.readFileSync(path.resolve('boss_stats.json'), 'utf8'));

    const promises = monitoredBosses.map(async (bossName) => {
      const lastSeen = await getBossLastSeen(bossName, world);
      const lastCheck = await getBossCheck(bossName, world);
      const kills = await getKillHistory(world, bossName);
      const totalKillsCount = kills.length;

      const formatBrt = (seenAtStr) => {
        if (!seenAtStr) return null;
        const gDate = parseDateStr(seenAtStr);
        if (!gDate) return seenAtStr;
        const brtDate = utcToBrt(germanToUtc(gDate));
        const pad = (n) => String(n).padStart(2, '0');
        return `${brtDate.getUTCFullYear()}-${pad(brtDate.getUTCMonth() + 1)}-${pad(brtDate.getUTCDate())} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
      };

      const baseName = bossName.replace(/\s*\(.*?\)\s*/g, '');
      const statsInfo = bossStats[baseName] || { hp: '?', immunities: [] };
      const mapLink = getBossMapLink(bossName, bossLocations);

      if (!lastSeen) {
        return {
          name: bossName,
          last_seen: null,
          seen_at_full: null,
          confirmed_by: null,
          city: null,
          days_since: null,
          expected_days: null,
          chance_percent: 0,
          status: 'Sem dados',
          total_kills: 0,
          kills_yesterday: 0,
          checked_at: null,
          checked_by: null,
          hp: statsInfo.hp,
          immunities: statsInfo.immunities,
          map_link: mapLink
        };
      }

      const germanSeenDate = parseDateStr(lastSeen.seen_at);
      let daysSince = 0;
      if (germanSeenDate) {
        const trackingStartGerman = new Date(germanSeenDate.getTime() - 10 * 60 * 60 * 1000);
        trackingStartGerman.setUTCHours(0, 0, 0, 0);

        const nowGerman = utcToGerman(now);
        const trackingNowGerman = new Date(nowGerman.getTime() - 10 * 60 * 60 * 1000);
        trackingNowGerman.setUTCHours(0, 0, 0, 0);
        
        const diffTime = Math.abs(trackingNowGerman - trackingStartGerman);
        daysSince = Math.round(diffTime / (1000 * 60 * 60 * 24));
      }

      const killsYesterday = kills.filter(k => k.kill_date === yesterdayStr).length;

      const stats = bossIntervals[bossName];
      let expectedDays = null;
      let chancePercent = 0;
      let status = 'Aguardando';

      if (stats && stats.fixedDaysFrequency) {
        const minDays = stats.fixedDaysFrequency.min;
        const maxDays = stats.fixedDaysFrequency.max;
        expectedDays = maxDays;

        const shiftMinDays = lastSeen.confirmed_by === 'TibiaData_API' ? -1 : 0;
        const adjustedMin = minDays + shiftMinDays;

        if (daysSince < adjustedMin) {
          chancePercent = adjustedMin > 0 ? Math.floor((daysSince / adjustedMin) * 49) : 0;
          status = 'Aguardando';
        } else if (daysSince >= adjustedMin && daysSince <= maxDays) {
          const range = maxDays - adjustedMin || 1;
          chancePercent = 50 + Math.floor(((daysSince - adjustedMin) / range) * 50);
          if (chancePercent >= 90) {
            status = 'Pode nascer';
          } else if (chancePercent >= 80) {
            status = 'Alta chance';
          } else {
            status = 'No radar';
          }
        } else {
          chancePercent = 100;
          status = 'Pode nascer';
        }
      }

      let checked_at = null;
      let checked_by = null;
      if (lastCheck) {
        const lastSeenTime = parseDateStr(lastSeen.seen_at);
        const lastCheckTime = parseDateStr(lastCheck.checked_at);
        if (lastCheckTime > lastSeenTime) {
          checked_at = lastCheck.checked_at;
          checked_by = await formatJidName(lastCheck.checked_by);
        }
      }

      return {
        name: bossName,
        last_seen: formatBrt(lastSeen.seen_at).split(' ')[0],
        seen_at_full: formatBrt(lastSeen.seen_at),
        confirmed_by: await formatJidName(lastSeen.confirmed_by),
        city: lastSeen.city,
        days_since: daysSince,
        expected_days: expectedDays,
        chance_percent: chancePercent,
        status,
        total_kills: totalKillsCount,
        kills_yesterday: killsYesterday,
        checked_at: checked_at ? formatBrt(checked_at) : null,
        checked_by,
        hp: statsInfo.hp,
        immunities: statsInfo.immunities,
        map_link: mapLink
      };
    });

    const predictions = await Promise.all(promises);

    predictions.sort((a, b) => {
      if (b.chance_percent !== a.chance_percent) return b.chance_percent - a.chance_percent;
      if (a.last_seen && b.last_seen) return 0;
      if (a.last_seen) return -1;
      return 1;
    });

    res.json({
      world,
      last_update: todayStr,
      bosses: predictions
    });
  } catch (err) {
    console.error('[WebAPI] Erro ao carregar previsões:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:world/:boss', async (req, res) => {
  const { world, boss } = req.params;
  try {
    const kills = await getKillHistory(world, boss);
    res.json({ world, boss, kills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export function startWebServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log(`✅ Web Dashboard rodando em: http://localhost:${PORT}`);
    console.log(`📡 Monitorando: ${process.env.TIBIA_WORLD || 'Quelibra'} | ${monitoredBosses.length} bosses`);
    console.log('=========================================');
  });
}
