import sqlite3 from 'sqlite3';
import fs from 'fs';
import { isGermanDST } from './database.js';

// Função auxiliar para reverter o formato antigo (Tracking Date + BRT Time) para UTC
function reverseOldDateToUtc(seenAt) {
  const [tDateStr, brtTimeStr] = seenAt.split(' ');
  const [tYear, tMonth, tDay] = tDateStr.split('-').map(Number);
  const [bHour, bMin] = brtTimeStr.split(':').map(Number);

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
  
  return new Date(Date.UTC(tYear, tMonth - 1, tDay, bHour + 3, bMin));
}

// Converte UTC para string do horário alemão (Novo formato)
function utcToGermanStr(utcDate) {
  const isDST = isGermanDST(utcDate);
  const offsetHours = isDST ? 2 : 1;
  const germanTime = new Date(utcDate.getTime() + offsetHours * 60 * 60 * 1000);
  
  const pad = (n) => String(n).padStart(2, '0');
  return `${germanTime.getUTCFullYear()}-${pad(germanTime.getUTCMonth() + 1)}-${pad(germanTime.getUTCDate())} ${pad(germanTime.getUTCHours())}:${pad(germanTime.getUTCMinutes())}`;
}

async function createFreshDb() {
  const oldDbFile = 'bossbot.db';
  const newDbFile = 'novo_bossbot.db';

  console.log(`[1] Verificando banco de dados atual (${oldDbFile})...`);
  if (!fs.existsSync(oldDbFile)) {
    console.error(`❌ O banco atual ${oldDbFile} não foi encontrado.`);
    return;
  }

  // Criamos uma cópia para preservar inscritos, chaves pushover e configurações
  console.log(`[2] Criando um novo banco de dados a partir da estrutura base (${newDbFile})...`);
  if (fs.existsSync(newDbFile)) {
    fs.unlinkSync(newDbFile);
  }
  fs.copyFileSync(oldDbFile, newDbFile);

  const db = new sqlite3.Database(newDbFile);

  const runQuery = (query, params = []) => new Promise((resolve, reject) => {
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
    console.log(`[3] Limpando históricos antigos para deixar o banco sem peso (zerado)...`);
    // Apaga todo o histórico de reports pesados e checks, deixando o DB "limpo"
    await runQuery('DELETE FROM boss_reports');
    await runQuery('DELETE FROM boss_check');
    console.log(`✅ Históricos antigos apagados com sucesso!`);

    console.log(`[4] Importando as ÚLTIMAS MORTES para o NOVO FORMATO (Horário da Alemanha)...`);
    const bosses = await allRows('SELECT world, boss_name, seen_at FROM boss_last_seen');
    let convertedCount = 0;
    
    for (const boss of bosses) {
      if (boss.seen_at && boss.seen_at.includes('-')) {
        const utcDate = reverseOldDateToUtc(boss.seen_at);
        const germanStr = utcToGermanStr(utcDate);
        
        await runQuery(
          'UPDATE boss_last_seen SET seen_at = ? WHERE world = ? AND boss_name = ?', 
          [germanStr, boss.world, boss.boss_name]
        );
        convertedCount++;
      }
    }
    
    console.log(`✅ Importação concluída! ${convertedCount} mortes recentes convertidas.`);
    console.log(`\n🎉 NOVO BANCO DE DADOS PRONTO: ${newDbFile}`);
    console.log(`Para usá-lo, basta renomear "novo_bossbot.db" para "bossbot.db" e reiniciar o bot!`);

  } catch (err) {
    console.error('❌ Erro durante o processo:', err);
  } finally {
    db.close();
  }
}

createFreshDb();
