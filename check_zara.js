import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('bossbot.db');

db.all("SELECT * FROM boss_last_seen WHERE boss_name LIKE '%Zarabustor%'", (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Antes:", rows);
    if (rows.length > 0) {
      db.run("UPDATE boss_last_seen SET seen_at = ? WHERE boss_name = ?", ["2026-06-22 20:00", rows[0].boss_name], function(err) {
        if (err) {
            console.error("Erro ao atualizar", err);
        } else {
            console.log("Atualizado Zarabustor para 2026-06-22 20:00.");
            db.all("SELECT * FROM boss_last_seen WHERE boss_name LIKE '%Zarabustor%'", (err, rows2) => {
                console.log("Depois:", rows2);
                db.close();
            });
        }
      });
    } else {
        db.close();
    }
  }
});
