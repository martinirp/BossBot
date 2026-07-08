import { db, setBossLastSeenDate } from './database.js';

async function rebuild() {
  const reports = await new Promise((res, rej) => {
    db.all("SELECT * FROM boss_reports ORDER BY created_at ASC", (err, rows) => {
      if (err) rej(err); else res(rows);
    });
  });

  await new Promise(res => db.run("DELETE FROM boss_last_seen", res));

  function utcToGerman(d) {
    return new Date(d.getTime() + 2 * 60 * 60 * 1000); // approx German time
  }

  for (const row of reports) {
    const utcDate = new Date(row.created_at.replace(' ', 'T') + 'Z');
    const germanDate = utcToGerman(utcDate);
    const pad = (n) => String(n).padStart(2, '0');
    const seenAtGerman = `${germanDate.getFullYear()}-${pad(germanDate.getMonth() + 1)}-${pad(germanDate.getDate())} ${pad(germanDate.getHours())}:${pad(germanDate.getMinutes())}`;
    
    let matchedCity = null;
    const vMatch = row.boss_name.match(/^(.+?)\s*\((.+?)\)$/);
    if (vMatch) matchedCity = vMatch[2];

    try {
      await setBossLastSeenDate(row.boss_name, row.reported_by_jid, seenAtGerman, row.world, matchedCity);
      console.log('Inserted', row.boss_name);
    } catch(err) {
      console.error('Error inserting', row.boss_name, err);
    }
  }

  console.log("Rebuild complete!");
  process.exit(0);
}

rebuild();
