import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

dotenv.config();
const dbFile = process.env.DB_FILE || 'bossbot.db';
const db = new sqlite3.Database(dbFile);

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runCommand(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

function isGermanDST(date) {
  const year = date.getUTCFullYear();
  const marchEnd = new Date(Date.UTC(year, 2, 31));
  while (marchEnd.getUTCDay() !== 0) marchEnd.setUTCDate(marchEnd.getUTCDate() - 1);
  const dstStart = new Date(Date.UTC(year, 2, marchEnd.getUTCDate(), 1, 0, 0));

  const octEnd = new Date(Date.UTC(year, 9, 31));
  while (octEnd.getUTCDay() !== 0) octEnd.setUTCDate(octEnd.getUTCDate() - 1);
  const dstEnd = new Date(Date.UTC(year, 9, octEnd.getUTCDate(), 1, 0, 0));

  return date >= dstStart && date < dstEnd;
}

function calcTrackingDayForDate(utcDate) {
  const brtNow = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
  const brtHour = brtNow.getUTCHours();
  const brtMin  = brtNow.getUTCMinutes();
  const brtTimeStr = `${String(brtHour).padStart(2, '0')}:${String(brtMin).padStart(2, '0')}`;
  
  const pad = (n) => String(n).padStart(2, '0');

  const isDST = isGermanDST(utcDate);
  const offsetHours = isDST ? 2 : 1;
  const germanTime = new Date(utcDate.getTime() + offsetHours * 60 * 60 * 1000);
  const trackingTime = new Date(germanTime.getTime() - 10 * 60 * 60 * 1000);

  const trackingYear = trackingTime.getUTCFullYear();
  const trackingMonth = pad(trackingTime.getUTCMonth() + 1);
  const trackingDay = pad(trackingTime.getUTCDate());
  const trackingDateStr = `${trackingYear}-${trackingMonth}-${trackingDay}`;

  const seenAt = `${trackingDateStr} ${brtTimeStr}`;
  return { seenAt, trackingDateStr };
}

async function main() {
  console.log('--- RESTORE REVERTED BOSSES ---');
  const world = process.env.TIBIA_WORLD || 'Quelibra';
  console.log(`Target World: ${world}`);

  // Fetch reports from the last 48 hours
  const recentReports = await runQuery(`
    SELECT r.boss_name, r.reported_by_jid, r.created_at
    FROM boss_reports r
    INNER JOIN (
      SELECT boss_name, MAX(created_at) as max_created
      FROM boss_reports
      WHERE created_at >= datetime('now', '-2 days')
        AND reported_by_jid != 'TibiaData_API'
        AND reported_by_jid != 'system_adjust'
        AND reported_by_jid != 'flop'
      GROUP BY boss_name
    ) latest ON r.boss_name = latest.boss_name AND r.created_at = latest.max_created
    WHERE r.world = ? OR r.world IS NULL
  `, [world]);

  if (recentReports.length === 0) {
    console.log('No recent reports found in the last 48 hours.');
    db.close();
    return;
  }

  console.log(`Found ${recentReports.length} reports in the last 48 hours to restore:`);

  for (const report of recentReports) {
    // Parse UTC date from SQLite
    const utcDate = new Date(report.created_at.replace(' ', 'T') + 'Z');
    if (isNaN(utcDate.getTime())) continue;

    const { seenAt } = calcTrackingDayForDate(utcDate);
    const cleanJid = report.reported_by_jid;

    // Parse city name if it exists (e.g. "The Voice Of Ruin (Esquerda)" -> Esquerda)
    let bossName = report.boss_name;
    let city = null;
    const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
    if (cityMatch) {
      bossName = cityMatch[1].trim();
      city = cityMatch[2].trim();
    }

    console.log(`Restoring: ${report.boss_name} -> seen_at: ${seenAt}, by: ${cleanJid}`);

    // Insert back into boss_last_seen
    await runCommand(`
      INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city, prev_confirmed_by, prev_seen_at, prev_city) 
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      ON CONFLICT(world, boss_name) DO UPDATE SET 
        confirmed_by = excluded.confirmed_by, 
        seen_at = excluded.seen_at, 
        city = excluded.city
    `, [world, report.boss_name, cleanJid, seenAt, city]);
  }

  console.log('Restoration completed successfully!');
  db.close();
}

main().catch(console.error);
