/**
 * fix_api_dates.js
 * Corrige todos os registros inseridos pelo TibiaData_API com a lógica antiga (daysAgo=1, horário 12:00).
 * O bug: o sync antigo gravava D-1 às 12:00. O correto é D-2 às 23:59.
 *
 * A correção é determinística: qualquer registro com confirmed_by='TibiaData_API' e hora '12:00'
 * foi gerado pelo código antigo e precisa ter 1 dia subtraído + hora alterada para 23:59.
 *
 * Uso: node scripts/fix_api_dates.js
 */

import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
dotenv.config();

const dbFile = process.env.DB_FILE || 'bossbot.db';
const db = new sqlite3.Database(dbFile);

// Mostra todos os registros que serão afetados
db.all(
  `SELECT world, boss_name, seen_at, confirmed_by FROM boss_last_seen
   WHERE confirmed_by = 'TibiaData_API' AND seen_at LIKE '% 12:00'
   ORDER BY world, boss_name`,
  [],
  (err, rows) => {
    if (err) { console.error('Erro ao consultar:', err); db.close(); return; }

    if (rows.length === 0) {
      console.log('Nenhum registro com data incorreta encontrado. Nada a corrigir.');
      db.close();
      return;
    }

    console.log(`Registros a corrigir (${rows.length}):`);
    for (const row of rows) {
      const oldDate = row.seen_at;
      // Calcula a data correta: D-1 (data antiga) - 1 dia = D-2, hora 23:59
      const [datePart] = oldDate.split(' ');
      const d = new Date(datePart + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 1);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const newDate = `${y}-${m}-${day} 23:59`;
      console.log(`  [${row.world}] ${row.boss_name}: ${oldDate} -> ${newDate}`);
    }

    console.log('\nAplicando correções...');

    // Aplica a correção via SQL diretamente
    db.run(
      `UPDATE boss_last_seen
       SET seen_at = STRFTIME('%Y-%m-%d', DATE(SUBSTR(seen_at, 1, 10), '-1 day')) || ' 23:59'
       WHERE confirmed_by = 'TibiaData_API' AND seen_at LIKE '% 12:00'`,
      function (err2) {
        if (err2) { console.error('Erro ao atualizar:', err2); db.close(); return; }
        console.log(`\nConcluido! ${this.changes} registro(s) corrigido(s).`);

        // Confirma o resultado
        db.all(
          `SELECT world, boss_name, seen_at, confirmed_by FROM boss_last_seen
           WHERE confirmed_by = 'TibiaData_API'
           ORDER BY world, boss_name`,
          [],
          (err3, updated) => {
            if (err3) { console.error('Erro ao verificar:', err3); db.close(); return; }
            console.log('\nEstado atual dos registros TibiaData_API:');
            for (const row of updated) {
              console.log(`  [${row.world}] ${row.boss_name}: ${row.seen_at}`);
            }
            db.close();
          }
        );
      }
    );
  }
);
