import * as db from '../database.js';
import fs from 'fs';
import path from 'path';

export default {
  name: 'registrados',
  aliases: ['bossesregistrados', 'confirmados', 'nascimentos'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    try {
      const allSeen = await db.getAllBossesLastSeen();

      if (allSeen.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `📭 Nenhum boss foi registrado até o momento.`
        }, { quoted: msg });
        return;
      }

      const statsPath = path.resolve('bosses_stats.json');
      let stats = {};
      if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      }

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

      const bossList = [];

      for (const record of allSeen) {
        const bName = record.boss_name;
        const seenAtStr = record.seen_at;
        const bossStat = stats[bName];

        let predictionStr = "Sem previsão";

        if (bossStat) {
          const minDays = bossStat.min_days || 0;
          const maxDays = bossStat.max_days || 0;

          if (minDays > 0 && maxDays > 0) {
            // A data no banco "seen_at" está em formato "YYYY-MM-DD HH:mm" no UTC-3
            const seenDate = new Date(seenAtStr.replace(' ', 'T') + ':00Z');
            const minDate = new Date(seenDate.getTime() + minDays * 24 * 60 * 60 * 1000);
            const maxDate = new Date(seenDate.getTime() + maxDays * 24 * 60 * 60 * 1000);

            predictionStr = `Entre ${formatFakeUtcDate(minDate)} e ${formatFakeUtcDate(maxDate)}`;
          }
        }

        bossList.push({
          name: bName,
          lastSeenFormatted: formatSeenAt(seenAtStr),
          prediction: predictionStr
        });
      }

      // Sort alphabetically by boss name
      bossList.sort((a, b) => a.name.localeCompare(b.name));

      let responseText = `*Bosses Registrados*\n\n`;
      for (const b of bossList) {
        responseText += `*${b.name}*\n`;
        responseText += `Último avistamento: ${b.lastSeenFormatted}\n`;
        responseText += `Previsão: ${b.prediction}\n\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: responseText.trim()
      }, { quoted: msg });

    } catch (err) {
      console.error('[registrados] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao listar os bosses registrados.`
      }, { quoted: msg });
    }
  }
};
