import sqlite3 from 'sqlite3';
import { isGermanDST } from './database.js';

// Função auxiliar para reverter o formato antigo de tracking_date + brt_time para UTC
function reverseOldDateToUtc(seenAt) {
  const [tDateStr, brtTimeStr] = seenAt.split(' ');
  const [tYear, tMonth, tDay] = tDateStr.split('-').map(Number);
  const [bHour, bMin] = brtTimeStr.split(':').map(Number);

  // O dia real BRT do kill só pode ser o mesmo dia do tracking_date ou o dia seguinte.
  // Vamos testar os dois dias para ver qual deles bate com a lógica antiga de tracking_date.
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const testBrtDate = new Date(Date.UTC(tYear, tMonth - 1, tDay + dayOffset, bHour + 3, bMin));
    const isDST = isGermanDST(testBrtDate);
    const offsetHours = isDST ? 2 : 1;
    const germanTime = new Date(testBrtDate.getTime() + offsetHours * 60 * 60 * 1000);
    const trackingTime = new Date(germanTime.getTime() - 10 * 60 * 60 * 1000);
    
    const pad = (n) => String(n).padStart(2, '0');
    const calcTrackingDateStr = `${trackingTime.getUTCFullYear()}-${pad(trackingTime.getUTCMonth() + 1)}-${pad(trackingTime.getUTCDate())}`;

    if (calcTrackingDateStr === tDateStr) {
      return testBrtDate;
    }
  }
  
  // Fallback seguro caso algo dê errado
  console.log(`⚠️ Não foi possível reverter com precisão a data: ${seenAt}`);
  return new Date(Date.UTC(tYear, tMonth - 1, tDay, bHour + 3, bMin));
}

// Converte UTC para string do horário alemão
function utcToGermanStr(utcDate) {
  const isDST = isGermanDST(utcDate);
  const offsetHours = isDST ? 2 : 1;
  const germanTime = new Date(utcDate.getTime() + offsetHours * 60 * 60 * 1000);
  
  const pad = (n) => String(n).padStart(2, '0');
  return `${germanTime.getUTCFullYear()}-${pad(germanTime.getUTCMonth() + 1)}-${pad(germanTime.getUTCDate())} ${pad(germanTime.getUTCHours())}:${pad(germanTime.getUTCMinutes())}`;
}

async function migrateDatabase() {
  const dbFile = process.env.DB_FILE || 'bossbot.db';
  console.log(`[Migração] Conectando ao banco: ${dbFile}`);
  
  const db = new sqlite3.Database(dbFile);
  
  const runQuery = (query, params) => new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });

  const allRows = (query) => new Promise((resolve, reject) => {
    db.all(query, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });

  try {
    // 1. Migrar boss_last_seen
    console.log('[Migração] Lendo registros de boss_last_seen...');
    const bosses = await allRows('SELECT id, seen_at FROM boss_last_seen');
    let migratedBosses = 0;
    
    for (const boss of bosses) {
      if (boss.seen_at && boss.seen_at.includes('-')) {
        const utcDate = reverseOldDateToUtc(boss.seen_at);
        const germanStr = utcToGermanStr(utcDate);
        await runQuery('UPDATE boss_last_seen SET seen_at = ? WHERE id = ?', [germanStr, boss.id]);
        migratedBosses++;
      }
    }
    console.log(`[Migração] ${migratedBosses} registros de boss_last_seen convertidos para o Horário da Alemanha.`);

    // 2. Migrar boss_checks
    console.log('[Migração] Lendo registros de boss_checks...');
    const checks = await allRows('SELECT id, checked_at FROM boss_checks');
    let migratedChecks = 0;
    
    for (const check of checks) {
      if (check.checked_at && check.checked_at.includes('-')) {
        const utcDate = reverseOldDateToUtc(check.checked_at);
        const germanStr = utcToGermanStr(utcDate);
        await runQuery('UPDATE boss_checks SET checked_at = ? WHERE id = ?', [germanStr, check.id]);
        migratedChecks++;
      }
    }
    console.log(`[Migração] ${migratedChecks} registros de boss_checks convertidos para o Horário da Alemanha.`);

    // 3. Migrar boss_reports
    console.log('[Migração] Lendo registros do histórico (boss_reports)...');
    const reports = await allRows('SELECT id, seen_at FROM boss_reports');
    let migratedReports = 0;
    
    for (const rep of reports) {
      if (rep.seen_at && rep.seen_at.includes('-')) {
        const utcDate = reverseOldDateToUtc(rep.seen_at);
        const germanStr = utcToGermanStr(utcDate);
        await runQuery('UPDATE boss_reports SET seen_at = ? WHERE id = ?', [germanStr, rep.id]);
        migratedReports++;
      }
    }
    console.log(`[Migração] ${migratedReports} registros de histórico convertidos para o Horário da Alemanha.`);

    console.log('✅ Migração finalizada com sucesso! O banco de dados agora possui o Horário Oficial da Alemanha como Single Source of Truth.');
  } catch (err) {
    console.error('❌ Erro na migração:', err);
  } finally {
    db.close();
  }
}

migrateDatabase();
