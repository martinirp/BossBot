import * as db from '../database.js';
import fs from 'fs';
import path from 'path';

export default {
  name: 'previsao',
  aliases: ['chances', 'tracker'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    try {
      const statsPath = path.resolve('bosses_stats.json');
      let stats = {};
      if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      }

      const allSeen = await db.getAllBossesLastSeen();
      
      const bossesWithPrediction = [];

      // Helper to format seen_at timestamp from "YYYY-MM-DD HH:mm" to "DD/MM/YYYY HH:mm"
      const formatSeenAt = (seenAtStr) => {
        const parts = seenAtStr.split(' ');
        if (parts.length !== 2) return seenAtStr;
        const dateParts = parts[0].split('-');
        if (dateParts.length !== 3) return seenAtStr;
        return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${parts[1]}`;
      };

      // Helper to format Date in "fake UTC" (matching Brazil timezone digits) to "DD/MM/YYYY HH:mm"
      const formatFakeUtcDate = (date) => {
        const pad = (n) => String(n).padStart(2, '0');
        const day = pad(date.getUTCDate());
        const month = pad(date.getUTCMonth() + 1);
        const year = date.getUTCFullYear();
        const hours = pad(date.getUTCHours());
        const minutes = pad(date.getUTCMinutes());
        return `${day}/${month}/${year} ${hours}:${minutes}`;
      };

      for (const record of allSeen) {
         const bName = record.boss_name;
         if (!stats[bName]) continue;

         const minDays = stats[bName].min_days || 0;
         const maxDays = stats[bName].max_days || 0;
         if (minDays === 0 || maxDays === 0) continue;

         const seenDate = new Date(record.seen_at.replace(' ', 'T') + ':00Z');
         const minDate = new Date(seenDate.getTime() + minDays * 24 * 60 * 60 * 1000);
         const maxDate = new Date(seenDate.getTime() + maxDays * 24 * 60 * 60 * 1000);

         bossesWithPrediction.push({
            name: bName,
            lastSeenFormatted: formatSeenAt(record.seen_at),
            prediction: `Entre ${formatFakeUtcDate(minDate)} e ${formatFakeUtcDate(maxDate)}`
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
