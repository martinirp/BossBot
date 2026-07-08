const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bossbot.db');

const MULTI_CITY_BOSSES = {
  "rotworm queen": ["Edron", "Darashia", "Liberty Bay", "Ab'Dendriel"],
  "the voice of ruin": ["Ghastly Dragons", "Lizard Chosens"],
  "flamecaller zazrak": ["Surface", "+1 North"],
  "tyrn": ["Drefia", "Liberty Bay"],
  "dreadmaw": ["Esquerda", "Direita"],
  "white pale": ["Edron", "Darashia", "Liberty Bay"],
  "hirintror": ["Formorgar Mines", "Nibelor"],
  "battlemaster zunzu": ["Esquerda", "Direita"],
  "fleabringer": ["Surface"],
  "albino dragon": ["Dragon Lair (Ankrahmun)", "Dragon Lair (Farmine)", "Dragon Lair (Fenrock)", "Dragon Lair (Goroma)", "Pits of Inferno"],
  "danimax": ["Thais", "Venore", "Carlin", "Edron", "Darashia"]
};

function utcToGerman(d) {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000); // approx German time
}

db.serialize(() => {
  db.all("SELECT * FROM boss_reports ORDER BY created_at ASC", (err, rows) => {
    if (err) throw err;
    db.run("DELETE FROM boss_last_seen", () => {
      let completed = 0;
      if (rows.length === 0) return db.close();
      
      for (const row of rows) {
        const utcDate = new Date(row.created_at.replace(' ', 'T') + 'Z');
        const germanDate = utcToGerman(utcDate);
        const pad = (n) => String(n).padStart(2, '0');
        const seenAtGerman = `${germanDate.getFullYear()}-${pad(germanDate.getMonth() + 1)}-${pad(germanDate.getDate())} ${pad(germanDate.getHours())}:${pad(germanDate.getMinutes())}`;
        
        let matchedCity = null;
        const vMatch = row.boss_name.match(/^(.+?)\s*\((.+?)\)$/);
        if (vMatch) matchedCity = vMatch[2];

        db.run(`
          INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(world, boss_name) DO UPDATE SET
            confirmed_by = excluded.confirmed_by,
            seen_at = excluded.seen_at,
            city = excluded.city
        `, [row.world, row.boss_name, row.reported_by_jid, seenAtGerman, matchedCity], () => {
          completed++;
          if (completed === rows.length) {
            console.log("Done");
            db.close();
          }
        });
      }
    });
  });
});
