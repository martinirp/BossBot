import sqlite3 from 'sqlite3';
import { MULTI_CITY_BOSSES } from './commands.js';

const db = new sqlite3.Database('bossbot.db');

const mappings = {
  "The Voice Of Ruin (Esquerda)": "The Voice Of Ruin (Ghastly Dragons)",
  "The Voice Of Ruin (Direita)": "The Voice Of Ruin (Lizard Chosens)",
  "Flamecaller Zazrak (North)": "Flamecaller Zazrak (+1 North)",
  "Dreadmaw (West)": "Dreadmaw (Esquerda)",
  "Dreadmaw (East)": "Dreadmaw (Direita)",
  "Hirintror (Mines)": "Hirintror (Formorgar Mines)",
  "Battlemaster Zunzu (West)": "Battlemaster Zunzu (Esquerda)",
  "Battlemaster Zunzu (East)": "Battlemaster Zunzu (Direita)",
  "Albino Dragon (Farmine)": "Albino Dragon (Dragon Lair (Farmine))",
  "Albino Dragon (Fenrock)": "Albino Dragon (Dragon Lair (Fenrock))",
  "Albino Dragon (Goroma)": "Albino Dragon (Dragon Lair (Goroma))",
  "Albino Dragon (POI)": "Albino Dragon (Pits of Inferno)",
  "Albino Dragon (Ank)": "Albino Dragon (Dragon Lair (Ankrahmun))"
};

db.serialize(() => {
  // Update boss_reports
  for (const [oldName, newName] of Object.entries(mappings)) {
    db.run("UPDATE boss_reports SET boss_name = ? WHERE boss_name = ?", [newName, oldName], function(err) {
      if (err) console.error(err);
      if (this.changes > 0) {
        console.log(`Updated ${this.changes} rows in boss_reports: ${oldName} -> ${newName}`);
      }
    });
  }

  // Also update boss_last_seen just in case there are orphaned rows
  for (const [oldName, newName] of Object.entries(mappings)) {
    const match = newName.match(/^(.+?)\s*\((.+?)\)$/);
    const newCity = match ? match[2] : null;
    
    db.run("UPDATE boss_last_seen SET boss_name = ?, city = ? WHERE boss_name = ?", [newName, newCity, oldName], function(err) {
      if (err) console.error(err);
      if (this.changes > 0) {
        console.log(`Updated ${this.changes} rows in boss_last_seen: ${oldName} -> ${newName}`);
      }
    });
  }
});

// Function to rebuild boss_last_seen from boss_reports using MULTI_CITY_BOSSES
function utcToGerman(d) {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000); // approx German time
}

async function rebuildLastSeen() {
  const bosses = await new Promise((res, rej) => db.all("SELECT DISTINCT boss_name, world FROM boss_reports", (err, rows) => err ? rej(err) : res(rows)));
  
  // Clear boss_last_seen
  await new Promise(res => db.run("DELETE FROM boss_last_seen", res));

  const bossBaseNames = new Set();
  for (const row of bosses) {
    const cityMatch = row.boss_name.match(/^(.+?)\s*\((.+?)\)$/);
    const baseName = cityMatch ? cityMatch[1].trim() : row.boss_name;
    bossBaseNames.add(JSON.stringify({ world: row.world, baseName }));
  }

  for (const item of bossBaseNames) {
    const { world, baseName } = JSON.parse(item);
    const cities = MULTI_CITY_BOSSES[baseName.toLowerCase()];
    const variants = cities ? cities.map(c => `${baseName} (${c})`) : [baseName];
    if (cities) variants.push(baseName);

    for (const variant of variants) {
      const latestReport = await new Promise((res, rej) => {
        db.get(`SELECT * FROM boss_reports WHERE world = ? AND boss_name = ? ORDER BY created_at DESC LIMIT 1`, [world, variant], (err, row) => err ? rej(err) : res(row));
      });

      if (latestReport) {
        const utcDate = new Date(latestReport.created_at.replace(' ', 'T') + 'Z');
        const germanDate = utcToGerman(utcDate);
        const pad = (n) => String(n).padStart(2, '0');
        const seenAtGerman = `${germanDate.getFullYear()}-${pad(germanDate.getMonth() + 1)}-${pad(germanDate.getDate())} ${pad(germanDate.getHours())}:${pad(germanDate.getMinutes())}`;
        
        let matchedCity = null;
        const vMatch = variant.match(/^(.+?)\s*\((.+?)\)$/);
        if (vMatch) matchedCity = vMatch[2];

        await new Promise((res, rej) => {
          db.run(`
            INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city)
            VALUES (?, ?, ?, ?, ?)
          `, [world, variant, latestReport.reported_by_jid, seenAtGerman, matchedCity], (err) => err ? rej(err) : res());
        });
        console.log(`Re-inserted boss_last_seen for ${variant}`);
      }
    }
  }
  
  db.close();
}

setTimeout(rebuildLastSeen, 1000);
