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

      // Helper to format seen_at timestamp from "YYYY-MM-DD HH:mm" to "DD/MM/YYYY HH:mm"
      const formatSeenAt = (seenAtStr) => {
        const parts = seenAtStr.split(' ');
        if (parts.length !== 2) return seenAtStr;
        const dateParts = parts[0].split('-');
        if (dateParts.length !== 3) return seenAtStr;
        return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${parts[1]}`;
      };

      // Helper to format Date in "fake UTC" (matching Brazil timezone digits) to "DD/MM/YYYY"
      const formatFakeUtcDate = (date) => {
        const pad = (n) => String(n).padStart(2, '0');
        const day = pad(date.getUTCDate());
        const month = pad(date.getUTCMonth() + 1);
        const year = date.getUTCFullYear();
        return `${day}/${month}/${year}`;
      };

      const today = new Date();
      for (const record of allSeen) {
         const bName = record.boss_name;
         if (!bossIntervals[bName]) continue;
         
         const stats = bossIntervals[bName];
         if (!stats.fixedDaysFrequency) continue;

         const minDays = stats.fixedDaysFrequency.min;
         const maxDays = stats.fixedDaysFrequency.max;

         // O seen_at armazena o "dia de rastreamento" do TibiaData
         const datePart = record.seen_at.split(' ')[0]; // "YYYY-MM-DD"
         const seenDate = new Date(datePart + 'T03:00:00Z');

         const shiftMinMs = record.confirmed_by === 'TibiaData_API' ? -24 * 60 * 60 * 1000 : 0;
         const minDate = new Date(seenDate.getTime() + minDays * 24 * 60 * 60 * 1000 + shiftMinMs);
         const maxDate = new Date(seenDate.getTime() + maxDays * 24 * 60 * 60 * 1000);
         
         // Calcula dias decorridos
         const diffTime = Math.abs(today - seenDate);
         const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) - 1; // Ajuste pra "dias desde a morte"

         let predictionStr = "";
         if (minDays === maxDays) {
           predictionStr = `A cada ${minDays} dia(s)`;
         } else {
           predictionStr = `Entre ${formatFakeUtcDate(minDate)} e ${formatFakeUtcDate(maxDate)}`;
         }
         
         let extraStr = "";
         if (minDays !== maxDays) {
           if (today >= maxDate) {
               extraStr = " (🟢 No radar / 🟢 Alta chance)";
           } else if (today >= minDate) {
               extraStr = " (🟢 No radar / 🟢 Com chance)";
           } else {
               // Ainda não está na faixa que pode nascer, então pulamos
               continue;
           }
         }

          const recentTimes = await db.getBossRecentTimes(bName);
          let predictionText = predictionStr + extraStr;
          if (recentTimes && recentTimes.length > 0) {
            predictionText += `\n⏰ *Últimos horários de morte:* ${recentTimes.join(', ')}`;
          }

          bossesWithPrediction.push({
             name: bName,
             lastSeenFormatted: formatSeenAt(record.seen_at),
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
