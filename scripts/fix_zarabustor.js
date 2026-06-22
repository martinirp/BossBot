/**
 * fix_zarabustor.js
 * Corrige o registro do Zarabustor que foi inserido com data errada pelo sync antigo.
 * O boss foi morto em 20/06/2026, mas o banco ficou com 21/06/2026 (bug do daysAgo=1).
 *
 * Uso: node scripts/fix_zarabustor.js
 */

import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
dotenv.config();

const dbFile = process.env.DB_FILE || 'bossbot.db';
const db = new sqlite3.Database(dbFile);

// Mostra o registro atual antes de alterar
db.get(
  `SELECT boss_name, world, seen_at, confirmed_by FROM boss_last_seen WHERE boss_name = 'Zarabustor'`,
  (err, row) => {
    if (err) { console.error('Erro ao consultar:', err); return; }
    if (!row) { console.log('Registro do Zarabustor não encontrado.'); db.close(); return; }

    console.log('Registro atual:', row);

    // Aplica a correção: data correta é 20/06/2026 23:59
    db.run(
      `UPDATE boss_last_seen SET seen_at = '2026-06-20 23:59' WHERE boss_name = 'Zarabustor'`,
      function (err2) {
        if (err2) { console.error('Erro ao atualizar:', err2); return; }
        console.log(`Corrigido! Linhas afetadas: ${this.changes}`);

        // Confirma o resultado
        db.get(
          `SELECT boss_name, world, seen_at, confirmed_by FROM boss_last_seen WHERE boss_name = 'Zarabustor'`,
          (err3, updated) => {
            if (err3) { console.error('Erro ao verificar:', err3); return; }
            console.log('Registro atualizado:', updated);
            db.close();
          }
        );
      }
    );
  }
);
