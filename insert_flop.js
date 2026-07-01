import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();
const dbFile = process.env.DB_FILE || 'bossbot.db';
const db = new sqlite3.Database(dbFile);

function runCommand(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

async function main() {
  const world = 'Quelibra';
  const bossName = 'Foreman Kneebiter';
  const seenAt = '2026-06-30 17:03';
  const reportedBy = 'flop';
  const createdAtUtc = '2026-06-30 20:03:00'; // 17:03 BRT in UTC

  console.log(`[MANUAL-FLOP] Inserting manual flop for ${bossName} on ${world}...`);

  // Update boss_last_seen
  await runCommand(`
    INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city, prev_confirmed_by, prev_seen_at, prev_city)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT(world, boss_name) DO UPDATE SET
      confirmed_by = excluded.confirmed_by,
      seen_at = excluded.seen_at,
      city = excluded.city,
      prev_confirmed_by = NULL,
      prev_seen_at = NULL,
      prev_city = NULL
  `, [world, bossName, reportedBy, seenAt]);

  // Insert into boss_reports
  await runCommand(`
    INSERT INTO boss_reports (boss_name, extra_text, reported_by_jid, notified_count, world, created_at)
    VALUES (?, 'Flopado', ?, 0, ?, ?)
  `, [bossName, reportedBy, world, createdAtUtc]);

  console.log('[MANUAL-FLOP] Successfully inserted and protected Foreman Kneebiter flop!');
  db.close();
}

main().catch(console.error);
