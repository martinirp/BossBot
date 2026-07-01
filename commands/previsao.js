import * as db from '../database.js';
import fs from 'fs';
import path from 'path';

const loadIntervals = () => {
  try {
    const jsonPath = path.resolve('boss_intervals.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error('[previsao] Error loading boss_intervals.json:', err);
    return {};
  }
};

export default {
  name: 'previsao',
  aliases: ['chances', 'tracker'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    try {
      const bossIntervals = loadIntervals();
      const world = await db.getGroupWorld(remoteJid);
      const allSeen = await db.getAllBossesLastSeen(world);
      
      const bossesWithPrediction = [];

      // Helper to format seen_at timestamp from German time to BRT "DD/MM/YYYY HH:mm"
      const formatSeenAtBrt = (seenAtStr) => {
         const germanDate = db.parseDateStr(seenAtStr);
         if (!germanDate) return seenAtStr;
         const brtDate = db.utcToBrt(db.germanToUtc(germanDate));
         const pad = (n) => String(n).padStart(2, '0');
         return `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
      };

      const today = new Date();
      for (const record of allSeen) {
         const bName = record.boss_name;
         if (!bossIntervals[bName]) continue;
         
         const stats = bossIntervals[bName];
         if (!stats.fixedDaysFrequency) continue;

         const minDays = stats.fixedDaysFrequency.min;
         const maxDays = stats.fixedDaysFrequency.max;

         const germanSeenDate = db.parseDateStr(record.seen_at);
         if (!germanSeenDate) continue;

         // Subtrai 10h para alinhar a data de contagem de ciclos (Server Save às 10:00 CEST/CET)
         const trackingStartGerman = new Date(germanSeenDate.getTime() - 10 * 60 * 60 * 1000);
         trackingStartGerman.setUTCHours(0, 0, 0, 0); // Zera para o início do dia do ciclo

         const shiftMinMs = record.confirmed_by === 'TibiaData_API' ? -24 * 60 * 60 * 1000 : 0;
         const minDateGerman = new Date(trackingStartGerman.getTime() + minDays * 24 * 60 * 60 * 1000 + shiftMinMs);
         const maxDateGerman = new Date(trackingStartGerman.getTime() + maxDays * 24 * 60 * 60 * 1000);
         
         // Para converter a data do ciclo de volta pra BRT para exibição
         minDateGerman.setUTCHours(10, 0, 0, 0);
         maxDateGerman.setUTCHours(10, 0, 0, 0);

         const minDateBrt = db.utcToBrt(db.germanToUtc(minDateGerman));
         const maxDateBrt = db.utcToBrt(db.germanToUtc(maxDateGerman));

         const formatBrtDate = (d) => {
           const pad = (n) => String(n).padStart(2, '0');
           return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
         };

         let predictionStr = "";
         if (minDays === maxDays) {
           predictionStr = `A cada ${minDays} dia(s)`;
         } else {
           predictionStr = `Entre ${formatBrtDate(minDateBrt)} e ${formatBrtDate(maxDateBrt)}`;
         }
         
         let extraStr = "";
         if (minDays !== maxDays) {
           const nowGerman = db.utcToGerman(today);
           const trackingNowGerman = new Date(nowGerman.getTime() - 10 * 60 * 60 * 1000);
           trackingNowGerman.setUTCHours(0, 0, 0, 0);

           minDateGerman.setUTCHours(0, 0, 0, 0);
           maxDateGerman.setUTCHours(0, 0, 0, 0);

           if (trackingNowGerman >= maxDateGerman) {
               extraStr = " (🟢 No radar / 🟢 Alta chance)";
           } else if (trackingNowGerman >= minDateGerman) {
               extraStr = " (🟢 No radar / 🟢 Com chance)";
           } else {
               continue;
           }
         }

          const recentTimes = await db.getBossRecentTimes(bName);
          const slicedRecentTimes = recentTimes.slice(-3);
          let predictionText = predictionStr + extraStr;
          if (slicedRecentTimes && slicedRecentTimes.length > 0) {
             // Opcional: Aqui poderíamos formatar as datas de recentTimes para BRT também
             const formattedRecents = slicedRecentTimes.map(t => formatSeenAtBrt(t));
             predictionText += `\n⏰ *Últimas aparições:* ${formattedRecents.join(', ')}`;
          }

          bossesWithPrediction.push({
             name: bName,
             lastSeenFormatted: formatSeenAtBrt(record.seen_at),
             prediction: predictionText
          });
      }

      if (bossesWithPrediction.length === 0) {
         await sock.sendMessage(remoteJid, {
            text: `Nenhuma previsão disponível no momento.`
         }, { quoted: msg });
         return;
      }

      // Sort alphabetically
      bossesWithPrediction.sort((a, b) => a.name.localeCompare(b.name));

      let textMsg = `*Previsão de Bosses*\n\n`;
      for (const b of bossesWithPrediction) {
          textMsg += `*${b.name}*\n`;
          textMsg += `Último avistamento: ${b.lastSeenFormatted}\n`;
          textMsg += `Previsão: ${b.prediction}\n\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: textMsg.trim()
      }, { quoted: msg });

    } catch (err) {
      console.error('[previsao] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao calcular as previsões.`
      }, { quoted: msg });
    }
  }
}
