import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
dotenv.config();

const dbFile = process.env.DB_FILE || 'bossbot.db';
const db = new sqlite3.Database(dbFile);

console.log(`[DB-CLEAN] Abrindo banco de dados: ${dbFile}`);

db.serialize(() => {
  // 1. Limpar boss_last_seen exceto Zarabustor, Rotworm Queen, The Voice Of Ruin e Flamecaller Zazrak
  db.run(
    "DELETE FROM boss_last_seen WHERE boss_name != 'Zarabustor' AND boss_name NOT LIKE 'Rotworm Queen%' AND boss_name NOT LIKE 'The Voice Of Ruin%' AND boss_name NOT LIKE 'Flamecaller Zazrak%'",
    function (err) {
      if (err) {
        console.error('[DB-CLEAN] Erro ao limpar boss_last_seen:', err);
      } else {
        console.log(`[DB-CLEAN] Registros removidos de boss_last_seen: ${this.changes}`);
      }
    }
  );

  // 2. Limpar boss_check exceto Zarabustor, Rotworm Queen, The Voice Of Ruin e Flamecaller Zazrak
  db.run(
    "DELETE FROM boss_check WHERE boss_name != 'Zarabustor' AND boss_name NOT LIKE 'Rotworm Queen%' AND boss_name NOT LIKE 'The Voice Of Ruin%' AND boss_name NOT LIKE 'Flamecaller Zazrak%'",
    function (err) {
      if (err) {
        console.error('[DB-CLEAN] Erro ao limpar boss_check:', err);
      } else {
        console.log(`[DB-CLEAN] Registros removidos de boss_check: ${this.changes}`);
      }
    }
  );
  
  db.close(() => {
    console.log('[DB-CLEAN] Limpeza concluída!');
  });
});
