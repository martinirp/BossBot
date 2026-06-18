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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

        // Create poll messages table
        db.run(`
          CREATE TABLE IF NOT EXISTS poll_messages (
            id TEXT PRIMARY KEY,
            message_json TEXT NOT NULL,
            deleted_from_whatsapp INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) return reject(err);
          
          // Alter table migration to ensure the column exists for existing databases
          db.run(`ALTER TABLE poll_messages ADD COLUMN deleted_from_whatsapp INTEGER DEFAULT 0`, () => {
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
    db.run(
      `INSERT OR REPLACE INTO user_pushover (jid, pushover_key) VALUES (?, ?)`,
      [cleanJid, key],
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
      `SELECT jid, pushover_key FROM user_pushover WHERE jid IN (${placeholders})`,
      cleanJids,
      (err, rows) => {
        if (err) return reject(err);
        const mapping = {};
        for (const row of rows) {
          mapping[row.jid] = row.pushover_key;
        }
        resolve(mapping);
      }
    );
  });
}

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
