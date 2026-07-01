import * as db from '../database.js';
import { db as rawDb } from '../database.js';

// Helper to check if Germany is in DST
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

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    rawDb.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function runCommand(query, params = []) {
  return new Promise((resolve, reject) => {
    rawDb.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

export default {
  name: 'restore',
  aliases: ['restaurar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderPhone } = context;

    console.log(`[SYSTEM] Manual restore requested by @${senderPhone}.`);

    let world = process.env.TIBIA_WORLD || 'Quelibra';
    try {
      const groupWorld = await db.getGroupWorld(remoteJid);
      if (groupWorld) world = groupWorld;
    } catch (err) {
      console.error('[RESTORE-CMD] Error getting group world:', err);
    }

    await sock.sendMessage(remoteJid, {
      text: `🔄 Analisando histórico de relatórios para restaurar bosses revertidos no mundo *${world}*...`
    }, { quoted: msg });

    try {
      // Query latest player reports (date-agnostic, case-insensitive)
      const recentReports = await runQuery(`
        SELECT r.boss_name, r.reported_by_jid, r.created_at
        FROM boss_reports r
        INNER JOIN (
          SELECT boss_name, MAX(created_at) as max_created
          FROM boss_reports
          WHERE LOWER(reported_by_jid) NOT IN ('tibiadata_api', 'system_adjust', 'flop')
          GROUP BY boss_name
        ) latest ON r.boss_name = latest.boss_name AND r.created_at = latest.max_created
        WHERE LOWER(r.world) = LOWER(?) OR r.world IS NULL
      `, [world]);

      if (recentReports.length === 0) {
        const debugLastReports = await runQuery(`
          SELECT boss_name, reported_by_jid, created_at, world
          FROM boss_reports
          ORDER BY created_at DESC
          LIMIT 5
        `);
        
        let debugText = `ℹ️ Nenhum boss reportado por jogadores nas últimas 48 horas no mundo *${world}* precisa de restauração.\n\n`;
        if (debugLastReports.length > 0) {
          debugText += `*Últimos 5 relatórios registrados (para depuração):*\n`;
          for (const r of debugLastReports) {
            debugText += `- ${r.boss_name} (${r.created_at}) [Mundo: ${r.world || 'null'}] por @${r.reported_by_jid.split('@')[0]}\n`;
          }
        } else {
          debugText += `⚠️ A tabela de relatórios está vazia no banco de dados.`;
        }

        await sock.sendMessage(remoteJid, { text: debugText }, { quoted: msg });
        return;
      }

      const restoredList = [];

      for (const report of recentReports) {
        const utcDate = new Date(report.created_at.replace(' ', 'T') + 'Z');
        if (isNaN(utcDate.getTime())) continue;

        const { seenAt } = calcTrackingDayForDate(utcDate);
        const cleanJid = report.reported_by_jid;

        let bossName = report.boss_name;
        let city = null;
        const cityMatch = bossName.match(/^(.+?)\s*\((.+?)\)$/);
        if (cityMatch) {
          bossName = cityMatch[1].trim();
          city = cityMatch[2].trim();
        }

        // Get current database status
        const currentLastSeen = await db.getBossLastSeen(report.boss_name, world);
        
        // If no db status or has different value, restore it
        if (!currentLastSeen || currentLastSeen.seen_at !== seenAt || currentLastSeen.confirmed_by !== cleanJid) {
          await runCommand(`
            INSERT INTO boss_last_seen (world, boss_name, confirmed_by, seen_at, city, prev_confirmed_by, prev_seen_at, prev_city) 
            VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
            ON CONFLICT(world, boss_name) DO UPDATE SET 
              confirmed_by = excluded.confirmed_by, 
              seen_at = excluded.seen_at, 
              city = excluded.city
          `, [world, report.boss_name, cleanJid, seenAt, city]);

          // Get phone/user name for formatting
          const phone = cleanJid.split('@')[0];
          const name = await db.getUserName(cleanJid) || `@${phone}`;
          const formattedDate = seenAt.split(' ')[0].split('-').reverse().join('/');
          const time = seenAt.split(' ')[1];

          restoredList.push(`- *${report.boss_name}* (Visto: ${formattedDate} às ${time} por ${name})`);
        }
      }

      if (restoredList.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `ℹ️ Todos os bosses do mundo *${world}* já estão em sincronia com o histórico de relatórios. Nada foi alterado.`
        }, { quoted: msg });
      } else {
        const responseText = `✅ *RESTAURAÇÃO CONCLUÍDA NO MUNDO ${world.toUpperCase()}!*\n\n` +
                             `Os seguintes bosses foram restaurados com sucesso no banco de dados:\n\n` +
                             `${restoredList.join('\n')}\n\n` +
                             `📈 Os tempos de spawn e previsões no bot e no painel foram recalculados com os dados originais.`;
        
        await sock.sendMessage(remoteJid, {
          text: responseText
        }, { quoted: msg });
      }
    } catch (err) {
      console.error('[RESTORE-CMD] Erro ao restaurar bosses:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Ocorreu um erro ao tentar restaurar os bosses. Verifique os logs do servidor.`
      }, { quoted: msg });
    }
  }
};
