import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
import { MULTI_CITY_BOSSES } from './commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // Limite maior para uploads base64

// Serve static dashboard page
app.use(express.static(path.join(__dirname, 'public')));
// Serve boss animated sprites
app.use('/assets/bosses', express.static(path.join(__dirname, 'assets', 'bosses')));

const PORT = 8080;

// ─── Auth ─────────────────────────────────────────────────────────────────────

const USERS = {
  'quelibra':  { password: 'quelibra123',  role: 'user'  },
  'admin':     { password: 'C7kgxmwt!@#', role: 'admin' }
};

const sessions = new Map(); // token -> { role, username }

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  req.userSession = sessions.get(token);
  next();
}

function adminMiddleware(req, res, next) {
  if (req.userSession?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado — somente admins' });
  }
  next();
}

// Dynamic boss list — re-reads bosses.json each call so admin changes are instant
function getMonitoredBosses() {
  const rawBosses = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
  const monitored = [];
  for (const boss of rawBosses) {
    const key = boss.toLowerCase();
    if (MULTI_CITY_BOSSES[key]) {
      for (const city of MULTI_CITY_BOSSES[key]) {
        monitored.push(`${boss} (${city})`);
      }
    } else {
      monitored.push(boss);
    }
  }
  return monitored;
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
  if (jid === 'TibiaData_API')  return 'TibiaData API';
  if (jid === 'system_adjust')  return 'Sistema';
  if (jid === 'flop')           return 'Flop';
  try {
    const name = await getUserName(jid);
    if (name) return name;
  } catch {}
  return jid.includes('@') ? `@${jid.split('@')[0]}` : jid;
}

function getKillHistory(world, bossName) {
  return new Promise((resolve, reject) => {
    const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
    let query, params;
    if (cityMatch) {
      // Bug fix (3): when a specific city is requested, filter only that city's records.
      // Also include base-name records (no city suffix) for backwards compatibility.
      const baseName = cityMatch[1].trim();
      const fullName = bossName.trim();
      query = `SELECT id, boss_name, reported_by_jid, extra_text, created_at FROM boss_reports WHERE world = ? AND (boss_name = ? OR boss_name = ?) ORDER BY created_at DESC`;
      params = [world, fullName, baseName];
    } else {
      query = `SELECT id, boss_name, reported_by_jid, extra_text, created_at FROM boss_reports WHERE world = ? AND boss_name = ? ORDER BY created_at DESC`;
      params = [world, bossName];
    }
    db.all(query, params, async (err, rows) => {
      if (err) return reject(err);
      if (!rows) return resolve([]);
      const mapped = [];
      for (const row of rows) {
        // Bug fix (2): created_at is stored in German (CET/CEST) time, not UTC.
        // Correct conversion: German → UTC → BRT.
        const germanDate = parseDateStr(row.created_at);
        const brtDate = utcToBrt(germanToUtc(germanDate));
        const pad = (n) => String(n).padStart(2, '0');
        const kill_date = `${brtDate.getUTCFullYear()}-${pad(brtDate.getUTCMonth() + 1)}-${pad(brtDate.getUTCDate())}`;
        const brtTimeStr = `${kill_date} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}:${pad(brtDate.getUTCSeconds())}`;
        const confirmed_by = await formatJidName(row.reported_by_jid);
        mapped.push({ id: row.id, boss_name: row.boss_name, raw_created_at: row.created_at, kill_date, amount_killed: 1, confirmed_by, extra_text: row.extra_text, created_at: brtTimeStr });
      }
      resolve(mapped);
    });
  });
}

// ─── Auth Endpoints ───────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  const token = generateToken();
  sessions.set(token, { role: user.role, username });
  res.json({ token, role: user.role, username });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ role: req.userSession.role, username: req.userSession.username });
});

// ─── Admin Endpoints ──────────────────────────────────────────────────────────

// GET all bosses (for admin panel list)
app.get('/api/admin/bosses-list', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const bosses = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
    res.json({ bosses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST rename boss
app.post('/api/admin/rename-boss', authMiddleware, adminMiddleware, async (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName?.trim() || !newName?.trim()) return res.status(400).json({ error: 'Nomes inválidos' });
  try {
    const bossesPath = path.resolve('bosses.json');
    let bosses = JSON.parse(fs.readFileSync(bossesPath, 'utf8'));
    const idx = bosses.findIndex(b => b.toLowerCase() === oldName.toLowerCase());
    if (idx === -1) return res.status(404).json({ error: 'Boss não encontrado em bosses.json' });
    bosses[idx] = newName.trim();
    fs.writeFileSync(bossesPath, JSON.stringify(bosses, null, 2), 'utf8');

    for (const [filePath, key] of [
      [path.resolve('boss_stats.json'),     oldName],
      [path.resolve('boss_locations.json'), oldName],
      [path.resolve('boss_intervals.json'), oldName],
    ]) {
      try {
        const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (obj[key]) { obj[newName.trim()] = obj[key]; delete obj[key]; }
        fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
      } catch {}
    }

    for (const tbl of ['boss_last_seen', 'boss_reports', 'subscriptions']) {
      await new Promise(r => db.run(`UPDATE ${tbl} SET boss_name = ? WHERE LOWER(boss_name) = LOWER(?)`, [newName.trim(), oldName], r));
    }
    res.json({ ok: true, message: `"${oldName}" renomeado para "${newName.trim()}"` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add boss
app.post('/api/admin/add-boss', authMiddleware, adminMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome inválido' });
  try {
    const bossesPath = path.resolve('bosses.json');
    let bosses = JSON.parse(fs.readFileSync(bossesPath, 'utf8'));
    if (bosses.some(b => b.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Boss já existe na lista' });
    }
    bosses.push(name.trim());
    bosses.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    fs.writeFileSync(bossesPath, JSON.stringify(bosses, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// POST upload boss image (base64)
app.post('/api/admin/upload-image', authMiddleware, adminMiddleware, (req, res) => {
  const { bossName, imageData, extension } = req.body;
  if (!bossName || !imageData || !extension) {
    return res.status(400).json({ error: 'Dados incompletos (bossName, imageData, extension)' });
  }
  const ext = extension.toLowerCase().replace('.', '');
  if (!['webp', 'gif', 'png'].includes(ext)) {
    return res.status(400).json({ error: 'Extensão não permitida. Use .webp, .gif ou .png' });
  }
  try {
    const base64Data = imageData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `${bossName}.${ext}`;
    const filePath = path.join(__dirname, 'assets', 'bosses', filename);
    fs.writeFileSync(filePath, buffer);
    res.json({ ok: true, filename });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add manual record (kill/flop)
app.post('/api/admin/manual-record', authMiddleware, adminMiddleware, async (req, res) => {
  const { bossName, type, datetime, world } = req.body;
  if (!bossName || !type || !datetime || !world) {
    return res.status(400).json({ error: 'Dados incompletos (bossName, type, datetime, world)' });
  }
  
  try {
    // datetime comes as "YYYY-MM-DDTHH:mm" in local browser time.
    // Convert this to UTC, then we will use this to register in DB
    const localDate = new Date(datetime);
    if (isNaN(localDate.getTime())) return res.status(400).json({ error: 'Data inválida' });
    
    const utcDate = new Date(localDate.getTime());
    const createdAtStr = utcDate.toISOString().replace('T', ' ').substring(0, 19);
    
    // For boss_last_seen, Tibia operates in Europe/Berlin (German time).
    const germanDate = utcToGerman(utcDate);
    const pad = (n) => String(n).padStart(2, '0');
    const seenAtGerman = `${germanDate.getFullYear()}-${pad(germanDate.getMonth() + 1)}-${pad(germanDate.getDate())} ${pad(germanDate.getHours())}:${pad(germanDate.getMinutes())}`;
    
    const reportedBy = req.userSession.username;
    const extraText = type === 'flop' ? 'Flopado' : 'Morto (Manual)';
    
    // Update boss_reports
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO boss_reports (boss_name, extra_text, reported_by_jid, notified_count, world, created_at) VALUES (?, ?, ?, 0, ?, ?)`,
        [bossName, extraText, reportedBy, world, createdAtStr],
        (err) => err ? reject(err) : resolve()
      );
    });
    
    // Update boss_last_seen
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(world, boss_name) DO UPDATE SET
          confirmed_by = excluded.confirmed_by,
          seen_at = excluded.seen_at,
          city = excluded.city,
          prev_confirmed_by = NULL,
          prev_seen_at = NULL,
          prev_city = NULL
      `, [world, bossName, reportedBy, seenAtGerman], (err) => err ? reject(err) : resolve());
    });
    
    res.json({ ok: true, message: `Registro '${type}' adicionado para ${bossName} com sucesso!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Function to recalculate boss_last_seen after history edits
async function recalculateLastSeen(world, bossName) {
  const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
  const baseName = cityMatch ? cityMatch[1].trim() : bossName;
  const cities = MULTI_CITY_BOSSES[baseName.toLowerCase()];
  
  const variants = cities ? cities.map(c => `${baseName} (${c})`) : [baseName];
  if (cities) variants.push(baseName);

  for (const variant of variants) {
    const latestReport = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM boss_reports WHERE world = ? AND boss_name = ? ORDER BY created_at DESC LIMIT 1`, [world, variant], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (latestReport) {
      // created_at in boss_reports is stored in German (CET/CEST) time.
      // parseDateStr interprets it as German time directly — use it as-is for seenAt.
      const storedGermanDate = parseDateStr(latestReport.created_at);
      const pad = (n) => String(n).padStart(2, '0');
      const seenAtGerman = `${storedGermanDate.getUTCFullYear()}-${pad(storedGermanDate.getUTCMonth() + 1)}-${pad(storedGermanDate.getUTCDate())} ${pad(storedGermanDate.getUTCHours())}:${pad(storedGermanDate.getUTCMinutes())}`;
      
      let matchedCity = null;
      const vMatch = variant.match(/^(.+?)\s*\((.+?)\)$/);
      if (vMatch) matchedCity = vMatch[2];

      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(world, boss_name) DO UPDATE SET
            confirmed_by = excluded.confirmed_by,
            seen_at = excluded.seen_at,
            city = excluded.city,
            prev_confirmed_by = NULL,
            prev_seen_at = NULL,
            prev_city = NULL
        `, [world, variant, latestReport.reported_by_jid, seenAtGerman, matchedCity], (err) => err ? reject(err) : resolve());
      });
    } else {
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM boss_last_seen WHERE world = ? AND boss_name = ?`, [world, variant], (err) => err ? reject(err) : resolve());
      });
    }
  }
}

// PUT edit history record
app.put('/api/admin/edit-record/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { datetime, city } = req.body;
  if (!datetime) return res.status(400).json({ error: 'Data/Hora é obrigatório' });

  try {
    const record = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM boss_reports WHERE id = ?`, [id], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!record) return res.status(404).json({ error: 'Registro não encontrado' });

    const localDate = new Date(datetime);
    if (isNaN(localDate.getTime())) return res.status(400).json({ error: 'Data inválida' });
    const utcDate = new Date(localDate.getTime());
    const createdAtStr = utcDate.toISOString().replace('T', ' ').substring(0, 19);

    const cityMatch = record.boss_name.match(/^(.+?)\s*\((.+?)\)$/);
    const baseName = cityMatch ? cityMatch[1].trim() : record.boss_name;
    let newBossName = record.boss_name;
    if (cityMatch && city) {
      newBossName = `${baseName} (${city})`;
    }

    await new Promise((resolve, reject) => {
      db.run(`UPDATE boss_reports SET created_at = ?, boss_name = ? WHERE id = ?`, [createdAtStr, newBossName, id], (err) => err ? reject(err) : resolve());
    });

    await recalculateLastSeen(record.world, baseName);
    res.json({ ok: true, message: 'Registro atualizado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE history record
app.delete('/api/admin/delete-record/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const record = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM boss_reports WHERE id = ?`, [id], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!record) return res.status(404).json({ error: 'Registro não encontrado' });

    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM boss_reports WHERE id = ?`, [id], (err) => err ? reject(err) : resolve());
    });

    await recalculateLastSeen(record.world, record.boss_name);
    res.json({ ok: true, message: 'Registro excluído' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET boss cities (for edit modal)
app.get('/api/boss-cities/:bossName', authMiddleware, (req, res) => {
  const bossName = req.params.bossName;
  const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
  const baseName = cityMatch ? cityMatch[1].trim() : bossName.trim();
  const cities = MULTI_CITY_BOSSES[baseName.toLowerCase()] || null;
  res.json({ cities });
});

// ─── API Endpoints ────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json({ defaultWorld: process.env.TIBIA_WORLD || 'Quelibra', port: PORT });
});

app.post('/api/fetch/:world', authMiddleware, async (req, res) => {
  const world = req.params.world;
  res.json({ message: `Coleta iniciada para o mundo ${world}...` });
  try { await syncWorldKillStatistics(world); } catch (err) {
    console.error(`[WebAPI] Erro ao sincronizar ${world}:`, err);
  }
});

app.get('/api/bosses/:world', authMiddleware, async (req, res) => {
  const world = req.params.world;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const yesterdayDate = new Date();
  yesterdayDate.setUTCHours(yesterdayDate.getUTCHours() - 3);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  const yesterdayStr = `${yesterdayDate.getUTCFullYear()}-${pad(yesterdayDate.getUTCMonth() + 1)}-${pad(yesterdayDate.getUTCDate())}`;

  try {
    const bossIntervals = JSON.parse(fs.readFileSync(path.resolve('boss_intervals.json'), 'utf8'));
    const bossLocations = JSON.parse(fs.readFileSync(path.resolve('boss_locations.json'), 'utf8'));
    const bossStats    = JSON.parse(fs.readFileSync(path.resolve('boss_stats.json'), 'utf8'));
    const monitoredBosses = getMonitoredBosses();

    const promises = monitoredBosses.map(async (bossName) => {
      const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
      let lastSeen = await getBossLastSeen(bossName, world);
      if (cityMatch) {
          const baseRecord = await getBossLastSeen(cityMatch[1].trim(), world);
          if (baseRecord && baseRecord.tibiadata_seen_at) {
              if (!lastSeen) {
                  lastSeen = { ...baseRecord, city: cityMatch[2].trim() };
              } else if (!lastSeen.tibiadata_seen_at || baseRecord.tibiadata_seen_at > lastSeen.tibiadata_seen_at) {
                  lastSeen.tibiadata_seen_at = baseRecord.tibiadata_seen_at;
                  if (lastSeen.confirmed_by === 'TibiaData_API' || lastSeen.confirmed_by === 'system_adjust') {
                      lastSeen.seen_at = baseRecord.seen_at;
                  }
              }
          }
      }
      const lastCheck = await getBossCheck(bossName, world);
      const kills = await getKillHistory(world, bossName);
      const totalKillsCount = kills.length;

      const formatBrt = (seenAtStr) => {
        if (!seenAtStr) return null;
        const gDate = parseDateStr(seenAtStr);
        if (!gDate) return seenAtStr;
        const brtDate = utcToBrt(germanToUtc(gDate));
        const p = (n) => String(n).padStart(2, '0');
        return `${brtDate.getUTCFullYear()}-${p(brtDate.getUTCMonth() + 1)}-${p(brtDate.getUTCDate())} ${p(brtDate.getUTCHours())}:${p(brtDate.getUTCMinutes())}`;
      };

      const m = bossName.match(/^(.+?)\s*\((.+?)\)$/);
      const baseName = m ? m[1].trim() : bossName.trim();
      const statsInfo = bossStats[baseName] || { hp: '?', immunities: [] };
      const mapLink = getBossMapLink(bossName, bossLocations);
      const intervalStats = bossIntervals[bossName];
      const minDays = (intervalStats?.fixedDaysFrequency) ? intervalStats.fixedDaysFrequency.min : null;
      const maxDays = (intervalStats?.fixedDaysFrequency) ? intervalStats.fixedDaysFrequency.max : null;

      if (!lastSeen) {
        return {
          name: bossName, last_seen: null, seen_at_full: null, confirmed_by: null,
          city: null, days_since: null, min_days: minDays, max_days: maxDays,
          expected_days: maxDays, chance_percent: 0, status: 'Sem dados',
          total_kills: 0, kills_yesterday: 0, checked_at: null, checked_by: null,
          hp: statsInfo.hp, immunities: statsInfo.immunities, map_link: mapLink,
          tibiadata_seen_at: null, tibiadata_chance_percent: null, tibiadata_status: null,
          tibiadata_min_date: null, tibiadata_max_date: null
        };
      }

      const germanSeenDate = parseDateStr(lastSeen.seen_at);
      let daysSince = 0;
      if (germanSeenDate) {
        const trackingStart = new Date(germanSeenDate.getTime() - 10 * 60 * 60 * 1000);
        trackingStart.setUTCHours(0, 0, 0, 0);
        const nowGerman = utcToGerman(now);
        const trackingNow = new Date(nowGerman.getTime() - 10 * 60 * 60 * 1000);
        trackingNow.setUTCHours(0, 0, 0, 0);
        daysSince = Math.round(Math.abs(trackingNow - trackingStart) / (1000 * 60 * 60 * 24));
      }

      const killsYesterday = kills.filter(k => k.kill_date === yesterdayStr).length;

      let chancePercent = 0, status = 'Aguardando';
      let tibiaChancePercent = null, tibiaStatus = null, tibiaMinDate = null, tibiaMaxDate = null;

      if (intervalStats?.fixedDaysFrequency) {
        const shiftMinDays = lastSeen.confirmed_by === 'TibiaData_API' ? -1 : 0;
        const adjustedMin = minDays + shiftMinDays;

        if (daysSince < adjustedMin) {
          chancePercent = adjustedMin > 0 ? Math.floor((daysSince / adjustedMin) * 49) : 0;
          status = 'Aguardando';
        } else if (daysSince <= maxDays) {
          const range = maxDays - adjustedMin || 1;
          chancePercent = 50 + Math.floor(((daysSince - adjustedMin) / range) * 50);
          status = chancePercent >= 90 ? 'Pode nascer' : chancePercent >= 80 ? 'Alta chance' : 'No radar';
        } else {
          chancePercent = 100; status = 'Pode nascer';
        }

        if (lastSeen.tibiadata_seen_at) {
          const tibiaSeenDate = new Date(lastSeen.tibiadata_seen_at.split(' ')[0] + 'T03:00:00Z');
          let tibiaDaysSince = Math.max(0, Math.ceil(Math.abs(now - tibiaSeenDate) / (1000 * 60 * 60 * 24)) - 1);
          const tibiaAdjMin = minDays - 1;
          if (tibiaDaysSince < tibiaAdjMin) {
            tibiaChancePercent = tibiaAdjMin > 0 ? Math.floor((tibiaDaysSince / tibiaAdjMin) * 49) : 0;
            tibiaStatus = 'Aguardando';
          } else if (tibiaDaysSince <= maxDays) {
            const range = maxDays - tibiaAdjMin || 1;
            tibiaChancePercent = 50 + Math.floor(((tibiaDaysSince - tibiaAdjMin) / range) * 50);
            tibiaStatus = tibiaChancePercent >= 90 ? 'Pode nascer' : tibiaChancePercent >= 80 ? 'Alta chance' : 'No radar';
          } else {
            tibiaChancePercent = 100; tibiaStatus = 'Pode nascer';
          }
          tibiaMinDate = new Date(tibiaSeenDate.getTime() + (minDays - 1) * 86400000).toISOString().split('T')[0];
          tibiaMaxDate = new Date(tibiaSeenDate.getTime() + maxDays * 86400000).toISOString().split('T')[0];
        }
      }

      let checked_at = null, checked_by = null;
      if (lastCheck) {
        const lsTime = parseDateStr(lastSeen.seen_at);
        const lcTime = parseDateStr(lastCheck.checked_at);
        if (lcTime > lsTime) {
          checked_at = lastCheck.checked_at;
          checked_by = await formatJidName(lastCheck.checked_by);
        }
      }

      return {
        name: bossName,
        last_seen: formatBrt(lastSeen.seen_at)?.split(' ')[0],
        seen_at_full: formatBrt(lastSeen.seen_at),
        confirmed_by: await formatJidName(lastSeen.confirmed_by),
        city: lastSeen.city, days_since: daysSince,
        min_days: minDays, max_days: maxDays, expected_days: maxDays,
        chance_percent: chancePercent, status,
        total_kills: totalKillsCount, kills_yesterday: killsYesterday,
        checked_at: checked_at ? formatBrt(checked_at) : null, checked_by,
        hp: statsInfo.hp, immunities: statsInfo.immunities, map_link: mapLink,
        tibiadata_seen_at: lastSeen.tibiadata_seen_at || null,
        tibiadata_chance_percent: tibiaChancePercent, tibiadata_status: tibiaStatus,
        tibiadata_min_date: tibiaMinDate, tibiadata_max_date: tibiaMaxDate
      };
    });

    const predictions = await Promise.all(promises);
    predictions.sort((a, b) => {
      if (b.chance_percent !== a.chance_percent) return b.chance_percent - a.chance_percent;
      return (a.last_seen ? 0 : 1) - (b.last_seen ? 0 : 1);
    });

    res.json({ world, last_update: todayStr, bosses: predictions });
  } catch (err) {
    console.error('[WebAPI] Erro ao carregar previsões:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:world/:boss', authMiddleware, async (req, res) => {
  const { world, boss } = req.params;
  try {
    const kills = await getKillHistory(world, boss);
    res.json({ world, boss, kills });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export function startWebServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log(`✅ Web Dashboard rodando em: http://localhost:${PORT}`);
    console.log(`📡 Monitorando: ${process.env.TIBIA_WORLD || 'Quelibra'}`);
    console.log('=========================================');
  });
}
