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

        // Create boss last seen table (upsert per boss)
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_last_seen (
            boss_name    TEXT PRIMARY KEY,
            confirmed_by TEXT NOT NULL,
            seen_at      TEXT NOT NULL
          )
        `);

        // Create boss check table (upsert per boss — checked but not found)
        db.run(`
          CREATE TABLE IF NOT EXISTS boss_check (
            boss_name  TEXT PRIMARY KEY,
            checked_by TEXT NOT NULL,
            checked_at TEXT NOT NULL
          )
        `, (err) => {
          if (err) return reject(err);
          
          // Run migrations to normalize existing JIDs in the database (remove device suffixes)
          db.serialize(() => {
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

export function updateBossLastSeen(bossName, jid) {
  const cleanJid = jidNormalizedUser(jid);
  const now = new Date();
  now.setHours(now.getHours() - 3); // UTC-3 Brazil
  const seenAt = now.toISOString().replace('T', ' ').substring(0, 16);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_last_seen (boss_name, confirmed_by, seen_at) VALUES (?, ?, ?)
       ON CONFLICT(boss_name) DO UPDATE SET confirmed_by = excluded.confirmed_by, seen_at = excluded.seen_at`,
      [bossName, cleanJid, seenAt],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getBossLastSeen(bossName) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT confirmed_by, seen_at FROM boss_last_seen WHERE boss_name = ?`,
      [bossName],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

// ─── Boss Check (checked and NOT found) ─────────────────────────────────────

export function updateBossCheck(bossName, jid) {
  const cleanJid = jidNormalizedUser(jid);
  const now = new Date();
  now.setHours(now.getHours() - 3); // UTC-3 Brazil
  const checkedAt = now.toISOString().replace('T', ' ').substring(0, 16);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO boss_check (boss_name, checked_by, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(boss_name) DO UPDATE SET checked_by = excluded.checked_by, checked_at = excluded.checked_at`,
      [bossName, cleanJid, checkedAt],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getBossCheck(bossName) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT checked_by, checked_at FROM boss_check WHERE boss_name = ?`,
      [bossName],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
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
