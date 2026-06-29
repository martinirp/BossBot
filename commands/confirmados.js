import * as db from '../database.js';

export default {
  name: 'confirmados',
  aliases: ['registrados', 'bossesregistrados', 'nascimentos'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    try {
      const world = await db.getGroupWorld(remoteJid);
      const allSeen = await db.getAllBossesLastSeen(world);

      if (allSeen.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `Nenhum boss foi registrado até o momento.`
        }, { quoted: msg });
        return;
      }

      // Helper to format seen_at timestamp from "YYYY-MM-DD HH:mm" to "DD/MM/YYYY HH:mm"
      const formatSeenAt = (seenAtStr) => {
        const parts = seenAtStr.split(' ');
        if (parts.length !== 2) return seenAtStr;
        const dateParts = parts[0].split('-');
        if (dateParts.length !== 3) return seenAtStr;
        return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${parts[1]}`;
      };

      // Sort alphabetically by boss name
      allSeen.sort((a, b) => a.boss_name.localeCompare(b.boss_name));

      let responseText = `*Bosses Confirmados*\n\n`;
      const mentions = [];

      for (const record of allSeen) {
        const bName = record.boss_name;
        const seenAtFormatted = formatSeenAt(record.seen_at);
        const confirmer = record.confirmed_by;

        const isLost = !confirmer || confirmer === 'TibiaData_API';
        const isSystem = confirmer === 'system_adjust';
        const isFlop = confirmer === 'flop';

        responseText += `*${bName}*\n`;
        if (isLost) {
          responseText += `Status: PERDIDO\n`;
        } else if (isFlop) {
          responseText += `Status: FLOPADO (Perdido)\n`;
        } else if (isSystem) {
          responseText += `Confirmado por: Sistema\n`;
        } else {
          const phone = confirmer.split('@')[0];
          responseText += `Confirmado por: @${phone}\n`;
          if (confirmer && confirmer.includes('@')) mentions.push(confirmer);
        }
        const label = (isLost || isFlop) ? 'Último morto' : 'Último avistamento';
        responseText += `${label}: ${seenAtFormatted}\n\n`;
      }

      // Deduplicate mentions
      const uniqueMentions = [...new Set(mentions)];

      await sock.sendMessage(remoteJid, {
        text: responseText.trim(),
        mentions: uniqueMentions
      }, { quoted: msg });

    } catch (err) {
      console.error('[confirmados] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao listar os bosses confirmados.`
      }, { quoted: msg });
    }
  }
};
