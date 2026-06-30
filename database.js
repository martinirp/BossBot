import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

dotenv.config();

const dbFile = process.env.DB_FILE || 'bossbot.db';
let db;

export function initDb() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbFile, (err) => {
      if (err) return reject(err);
      
      const defaultWorld = process.env.TIBIA_WORLD || 'Quelibra';

      db.serialize(() => {
        // Create subscriptions table
        db.run(`
          CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            boss_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(jid, boss_name)
          )
        `);

        // Create user_pushover table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_pushover (
            jid TEXT PRIMARY KEY,
            pushover_key TEXT NOT NULL,
            alert_level INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // Migrate existing DBs (ignore error if column already exists)
        db.run(`ALTER TABLE user_pushover ADD COLUMN alert_level INTEGER DEFAULT 1`, () => {});

        // Create allowed_groups table
        db.run(`
          CREATE TABLE IF NOT EXISTS allowed_groups (
            jid TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create global_settings table
        db.run(`
          CREATE TABLE IF NOT EXISTS global_settings (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `);

        // Create boss reports history table
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            boss_name TEXT NOT NULL,
            extra_text TEXT,
            reported_by_jid TEXT NOT NULL,
            notified_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create monthly boss rank table
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_rank (
            jid   TEXT    NOT NULL,
            month INTEGER NOT NULL,
            year  INTEGER NOT NULL,
            count INTEGER DEFAULT 0,
            PRIMARY KEY (jid, month, year)
          )
        `);

        // Create users table for names
        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            name TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);


        // Create boss last seen table (with composite primary key)
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_last_seen (
            world        TEXT NOT NULL,
            boss_name    TEXT NOT NULL,
            confirmed_by TEXT NOT NULL,
            seen_at      TEXT NOT NULL,
            city         TEXT,
            PRIMARY KEY (world, boss_name)
          )
        `);

        // Create boss check table (with composite primary key)
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_check (
            world      TEXT NOT NULL,
            boss_name  TEXT NOT NULL,
            checked_by TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            city         TEXT,
            PRIMARY KEY (world, boss_name)
          )
        `);

        // Migrate boss_last_seen and boss_check to include city column
        db.run(`ALTER TABLE boss_last_seen ADD COLUMN city TEXT`, () => {});
        db.run(`ALTER TABLE boss_check ADD COLUMN city TEXT`, () => {});

        // Migrate boss_last_seen to include prev_* columns for false alarm reverts
        db.run(`ALTER TABLE boss_last_seen ADD COLUMN prev_confirmed_by TEXT`, () => {});
        db.run(`ALTER TABLE boss_last_seen ADD COLUMN prev_seen_at TEXT`, () => {});
        db.run(`ALTER TABLE boss_last_seen ADD COLUMN prev_city TEXT`, () => {});

        // Migrate allowed_groups: add tibia_world column if not exists
        db.run(`ALTER TABLE allowed_groups ADD COLUMN tibia_world TEXT`, () => {
          db.run(`UPDATE allowed_groups SET tibia_world = ? WHERE tibia_world IS NULL`, [defaultWorld]);
        });

        // Migrate boss_last_seen to composite primary key
        db.all(`PRAGMA table_info(boss_last_seen)`, [], (err, columns) => {
          if (err) return;
          const hasWorld = columns.some(c => c.name === 'world');
          if (!hasWorld) {
            db.serialize(() => {
              db.run(`ALTER TABLE boss_last_seen RENAME TO old_boss_last_seen`);
              db.run(`
                CREATE TABLE boss_last_seen (
                  world        TEXT NOT NULL,
                  boss_name    TEXT NOT NULL,
                  confirmed_by TEXT NOT NULL,
                  seen_at      TEXT NOT NULL,
                  PRIMARY KEY (world, boss_name)
                )
              `);
              db.run(`
                INSERT OR IGNORE INTO boss_last_seen (world, boss_name, confirmed_by, seen_at)
                SELECT ?, boss_name, confirmed_by, seen_at FROM old_boss_last_seen
              `, [defaultWorld], () => {
                db.run(`DROP TABLE old_boss_last_seen`);
              });
            });
          }
        });

        // Migrate boss_check to composite primary key
        db.all(`PRAGMA table_info(boss_check)`, [], (err, columns) => {
          if (err) return;
          const hasWorld = columns.some(c => c.name === 'world');
          if (!hasWorld) {
            db.serialize(() => {
              db.run(`ALTER TABLE boss_check RENAME TO old_boss_check`);
              db.run(`
                CREATE TABLE boss_check (
                  world      TEXT NOT NULL,
                  boss_name  TEXT NOT NULL,
                  checked_by TEXT NOT NULL,
                  checked_at TEXT NOT NULL,
                  PRIMARY KEY (world, boss_name)
                )
              `);
              db.run(`
                INSERT OR IGNORE INTO boss_check (world, boss_name, checked_by, checked_at)
                SELECT ?, boss_name, checked_by, checked_at FROM old_boss_check
              `, [defaultWorld], () => {
                db.run(`DROP TABLE old_boss_check`);
              });
            });
          }
        });

        // Run migrations to normalize existing JIDs in the database (remove device suffixes)
        db.run(`
          UPDATE subscriptions 
          SET jid = REPLACE(jid, SUBSTR(jid, INSTR(jid, ':'), INSTR(jid, '@') - INSTR(jid, ':')), '') 
          WHERE jid LIKE '%:%'
        `);
        
        db.run(`
          UPDATE boss_reports 
          SET reported_by_jid = REPLACE(reported_by_jid, SUBSTR(reported_by_jid, INSTR(reported_by_jid, ':'), INSTR(reported_by_jid, '@') - INSTR(reported_by_jid, ':')), '') 
          WHERE reported_by_jid LIKE '%:%'
        `, (migrationErr) => {
          if (migrationErr) return reject(migrationErr);
          resolve();
        });

      });
    });
  });
}

export function addSubscription(jid, bossName) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO subscriptions (jid, boss_name) VALUES (?, ?)`,
      [cleanJid, bossName],
      function (err) {
        if (err) return reject(err);
        // this.changes is 1 if inserted, 0 if already existed (ignored)
        resolve(this.changes > 0);
      }
    );
  });
}

export function removeSubscription(jid, bossName) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM subscriptions WHERE jid = ? AND boss_name = ?`,
      [cleanJid, bossName],
      function (err) {
        if (err) return reject(err);
        // this.changes is 1 if deleted, 0 if didn't exist
        resolve(this.changes > 0);
      }
    );
  });
}

export function clearSubscriptionsForJid(jid) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM subscriptions WHERE jid = ?`,
      [cleanJid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes); // returns how many subscriptions were deleted
      }
    );
  });
}


export function getSubscribers(bossName) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT jid FROM subscriptions WHERE boss_name = ?`,
      [bossName],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.jid));
      }
    );
  });
}

export function getBossSubscriptionsForJid(jid) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT boss_name FROM subscriptions WHERE jid = ? ORDER BY boss_name ASC`,
      [cleanJid],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.boss_name));
      }
    );
  });
}

export function addBossReport(bossName, extraText, reportedByJid, notifiedCount) {
  const cleanJid = jidNormalizedUser(reportedByJid);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_reports (boss_name, extra_text, reported_by_jid, notified_count) VALUES (?, ?, ?, ?)`,
      [bossName, extraText, cleanJid, notifiedCount],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}



export function setUserPushoverKey(jid, key) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    // We use INSERT ... ON CONFLICT UPDATE or similar. In sqlite < 3.24 INSERT OR REPLACE replaces the whole row.
    // If we replace the row, alert_level is lost. We need to do an update or insert.
    db.run(
      `INSERT INTO user_pushover (jid, pushover_key) VALUES (?, ?) 
       ON CONFLICT(jid) DO UPDATE SET pushover_key = excluded.pushover_key`,
      [cleanJid, key],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function setUserAlertLevel(jid, level) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE user_pushover SET alert_level = ? WHERE jid = ?`,
      [level, cleanJid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function getUserPushoverKey(jid) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT pushover_key FROM user_pushover WHERE jid = ?`,
      [cleanJid],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.pushover_key : null);
      }
    );
  });
}

export function removeUserPushoverKey(jid) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM user_pushover WHERE jid = ?`,
      [cleanJid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function getPushoverKeysForSubscribers(jids) {
  if (!jids || jids.length === 0) return Promise.resolve({});
  const cleanJids = jids.map(jid => jidNormalizedUser(jid));
  const placeholders = cleanJids.map(() => '?').join(',');
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT jid, pushover_key, alert_level FROM user_pushover WHERE jid IN (${placeholders})`,
      cleanJids,
      (err, rows) => {
        if (err) return reject(err);
        const mapping = {};
        for (const row of rows) {
          mapping[row.jid] = {
            key: row.pushover_key,
            alert_level: row.alert_level !== undefined && row.alert_level !== null ? row.alert_level : 1
          };
        }
        resolve(mapping);
      }
    );
  });
}

export function addGroup(jid) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO allowed_groups (jid) VALUES (?)',
      [jid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function removeGroup(jid) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM allowed_groups WHERE jid = ?',
      [jid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function getAllowedGroups() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT jid FROM allowed_groups',
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.jid));
      }
    );
  });
}
export function setGlobalSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO global_settings (key, value) VALUES (?, ?) 
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(value)],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function getGlobalSetting(key) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT value FROM global_settings WHERE key = ?',
      [key],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.value : null);
      }
    );
  });
}

// ─── Boss Rank ──────────────────────────────────────────────────────────────

export function incrementRank(jid) {
  const cleanJid = jidNormalizedUser(jid);
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_rank (jid, month, year, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(jid, month, year) DO UPDATE SET count = count + 1`,
      [cleanJid, month, year],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getMonthlyRank(month, year) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT jid, count FROM boss_rank WHERE month = ? AND year = ? ORDER BY count DESC LIMIT 20`,
      [month, year],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

// ─── Boss Last Seen ──────────────────────────────────────────────────────────

export function updateBossLastSeen(bossName, jid, world = 'Quelibra', city = null) {
  const cleanJid = jidNormalizedUser(jid);
  const now = new Date();
  now.setUTCHours(now.getUTCHours() - 3); // Converte UTC -> BRT (UTC-3)
  const seenAt = now.toISOString().replace('T', ' ').substring(0, 16);
  return setBossLastSeenDate(bossName, cleanJid, seenAt, world, city);
}

export function setBossLastSeenDate(bossName, jid, seenAt, world = 'Quelibra', city = null) {
  const cleanJid = (jid && jid.includes('@')) ? jidNormalizedUser(jid) : jid;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city, prev_confirmed_by, prev_seen_at, prev_city) 
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT(world, boss_name) DO UPDATE SET 
         prev_confirmed_by = boss_last_seen.confirmed_by, 
         prev_seen_at = boss_last_seen.seen_at, 
         prev_city = boss_last_seen.city, 
         confirmed_by = excluded.confirmed_by, 
         seen_at = excluded.seen_at, 
         city = excluded.city`,
      [world, bossName, cleanJid, seenAt, city],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function revertBossLastSeen(bossName, world = 'Quelibra') {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT prev_seen_at FROM boss_last_seen WHERE boss_name = ? AND world = ?`,
      [bossName, world],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(false);

        if (!row.prev_seen_at) {
          db.run(
            `DELETE FROM boss_last_seen WHERE boss_name = ? AND world = ?`,
            [bossName, world],
            function (err) {
              if (err) return reject(err);
              resolve(true);
            }
          );
        } else {
          db.run(
            `UPDATE boss_last_seen SET 
               confirmed_by = prev_confirmed_by,
               seen_at = prev_seen_at,
               city = prev_city,
               prev_confirmed_by = NULL,
               prev_seen_at = NULL,
               prev_city = NULL
             WHERE boss_name = ? AND world = ?`,
            [bossName, world],
            function (err) {
              if (err) return reject(err);
              resolve(true);
            }
          );
        }
      }
    );
  });
}

export function getBossLastSeen(bossName, world = 'Quelibra') {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT confirmed_by, seen_at, city FROM boss_last_seen WHERE boss_name = ? AND world = ?`,
      [bossName, world],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

export function getAllBossesLastSeen(world = 'Quelibra') {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT boss_name, confirmed_by, seen_at, city FROM boss_last_seen WHERE world = ?`,
      [world],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// ─── Boss Check (checked and NOT found) ─────────────────────────────────────

export function updateBossCheck(bossName, jid, world = 'Quelibra', city = null) {
  const cleanJid = jidNormalizedUser(jid);
  const now = new Date();
  now.setUTCHours(now.getUTCHours() - 3); // Converte UTC -> BRT (UTC-3)
  const checkedAt = now.toISOString().replace('T', ' ').substring(0, 16);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_check (world, boss_name, checked_by, checked_at, city) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(world, boss_name) DO UPDATE SET checked_by = excluded.checked_by, checked_at = excluded.checked_at, city = excluded.city`,
      [world, bossName, cleanJid, checkedAt, city],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getBossCheck(bossName, world = 'Quelibra') {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT checked_by, checked_at, city FROM boss_check WHERE boss_name = ? AND world = ?`,
      [bossName, world],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

// ─── World Configurations ────────────────────────────────────────────────────

export function getUniqueWorlds() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT tibia_world FROM allowed_groups WHERE tibia_world IS NOT NULL`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows ? rows.map(r => r.tibia_world) : []);
      }
    );
  });
}

export function getGroupWorld(jid) {
  const defaultWorld = process.env.TIBIA_WORLD || 'Quelibra';
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT tibia_world FROM allowed_groups WHERE jid = ?`,
      [jid],
      (err, row) => {
        if (err) return reject(err);
        resolve(row && row.tibia_world ? row.tibia_world : defaultWorld);
      }
    );
  });
}

export function setGroupWorld(jid, world) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE allowed_groups SET tibia_world = ? WHERE jid = ?`,
      [world, jid],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// ─── Users (Names) ───────────────────────────────────────────────────────────

export function upsertUser(jid, name) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (jid, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
      [cleanJid, name],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

export function getUserName(jid) {
  const cleanJid = jidNormalizedUser(jid);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT name FROM users WHERE jid = ?`,
      [cleanJid],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.name : null);
      }
    );
  });
}

export function getAllUserNames() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT jid, name FROM users`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        const mapping = {};
        for (const row of (rows || [])) {
          mapping[row.jid] = row.name;
        }
        resolve(mapping);
      }
    );
  });
}
export function getBossRecentTimes(bossName, limit = 4) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT created_at FROM boss_reports WHERE boss_name = ? OR boss_name LIKE ? ORDER BY created_at DESC LIMIT ?`,
      [bossName, `${bossName} (%`, limit],
      (err, rows) => {
        if (err) return reject(err);
        if (!rows || rows.length === 0) return resolve([]);

        const times = [];
        const seen = new Set();
        for (const row of rows) {
          if (!row.created_at) continue;
          // SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS"
          const utcDate = new Date(row.created_at.replace(' ', 'T') + 'Z');
          if (isNaN(utcDate.getTime())) continue;

          // Convert to BRT (UTC-3)
          const brtDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
          
          const day = String(brtDate.getUTCDate()).padStart(2, '0');
          const month = String(brtDate.getUTCMonth() + 1).padStart(2, '0');
          const year = brtDate.getUTCFullYear();
          const hours = String(brtDate.getUTCHours()).padStart(2, '0');
          const minutes = String(brtDate.getUTCMinutes()).padStart(2, '0');
          const formatted = `${day}/${month}/${year} às ${hours}:${minutes}`;
          if (!seen.has(formatted)) {
            seen.add(formatted);
            times.push(formatted);
          }
        }

        // Return sorted chronologically (oldest to newest)
        resolve(times.reverse());
      }
    );
  });
}

// ─── Misc ────────────────────────────────────────────────────────────────────


export function closeDb() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    db.close((err) => {
      if (err) return reject(err);
      db = null;
      resolve();
    });
  });
}
