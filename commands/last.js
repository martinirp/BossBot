import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities } from '../commands.js';

// Helper to format seen_at timestamp from German time to BRT "DD/MM/YYYY HH:mm"
const formatSeenAtBrt = (seenAtStr, isTibiaData = false) => {
  if (!seenAtStr) return 'Nenhum avistamento registrado ainda';
  
  if (isTibiaData) {
    const [year, month, day] = seenAtStr.split(' ')[0].split('-');
    return `${day}/${month}/${year}`;
  }

  const germanDate = db.parseDateStr(seenAtStr);
  if (!germanDate) return seenAtStr;
  const brtDate = db.utcToBrt(db.germanToUtc(germanDate));
  const pad = (n) => String(n).padStart(2, '0');
  
  const datePart = `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()}`;
  return `${datePart} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
};

export default {
  name: 'last',
  aliases: ['historico', 'histórico', 'ultimo', 'último'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}last ferumbras\``
      }, { quoted: msg });
      return;
    }

    const bossRaw = args.join(' ');
    const bossesList = loadBosses();
    const matchResult = findBossMatch(bossRaw, bossesList);

    if (!matchResult.match) {
      if (matchResult.suggestions.length > 0) {
        const s = matchResult.suggestions.map(b => `*${b}*`).join(', ');
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado. Você quis dizer: ${s}?`
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado.`
        }, { quoted: msg });
      }
      return;
    }

    const bossName = matchResult.match;
    const world = await db.getGroupWorld(remoteJid);

    // Checagem de boss multi-cidades
    const cities = getBossCities(bossName);
    if (cities) {
      const records = [];
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        const record = await db.getBossLastSeen(cityBossName, world);
        records.push({ city, record });
      }

      const hasAnyRecord = records.some(r => r.record !== null);
      if (!hasAnyRecord) {
        await sock.sendMessage(remoteJid, {
          text: `⚔️ *${bossName}*\n\n📭 Nenhum avistamento registrado ainda para nenhuma cidade.`
        }, { quoted: msg });
        return;
      }

      let reply = `⚔️ *${bossName}*\n\n`;
      const mentions = [];
      for (const item of records) {
        reply += `📍 *${item.city}*:\n`;
        if (item.record) {
          const confirmer = item.record.confirmed_by;
          const isTibiaData = (confirmer === 'TibiaData_API');
          reply += `👁️ Último avistamento: *${formatSeenAtBrt(item.record.seen_at, isTibiaData)}*\n`;
          if (!confirmer) {
            reply += `👤 Por: Desconhecido\n\n`;
          } else if (confirmer === 'flop') {
            reply += `👤 Por: Flop (Perdido)\n\n`;
          } else if (confirmer === 'TibiaData_API') {
            reply += `👤 Por: TibiaData API\n\n`;
          } else if (confirmer === 'system_adjust') {
            reply += `👤 Por: Sistema\n\n`;
          } else if (confirmer.includes('@')) {
            const phone = confirmer.split('@')[0];
            reply += `👤 Por: @${phone}\n\n`;
            mentions.push(confirmer);
          } else {
            reply += `👤 Por: ${confirmer}\n\n`;
          }
        } else {
          reply += `📭 Nenhum avistamento registrado ainda.\n\n`;
        }
      }

      await sock.sendMessage(remoteJid, {
        text: reply.trim(),
        mentions
      }, { quoted: msg });
      return;
    }

    const record = await db.getBossLastSeen(bossName, world);

    if (!record) {
      await sock.sendMessage(remoteJid, {
        text: `⚔️ *${bossName}*\n\n📭 Nenhum avistamento registrado ainda.`
      }, { quoted: msg });
      return;
    }

    const cityText = record.city ? ` (${record.city})` : '';
    const confirmer = record.confirmed_by;
    let text = `⚔️ *${bossName}*\n\n👁️ Último avistamento: *${formatSeenAtBrt(record.seen_at)}*${cityText}\n`;
    const singleMentions = [];

    if (!confirmer) {
      text += `👤 Por: Desconhecido`;
    } else if (confirmer === 'flop') {
      text += `👤 Por: Flop (Perdido)`;
    } else if (confirmer === 'TibiaData_API') {
      text += `👤 Por: TibiaData API`;
    } else if (confirmer === 'system_adjust') {
      text += `👤 Por: Sistema`;
    } else if (confirmer.includes('@')) {
      const phone = confirmer.split('@')[0];
      text += `👤 Por: @${phone}`;
      singleMentions.push(confirmer);
    } else {
      text += `👤 Por: ${confirmer}`;
    }

    await sock.sendMessage(remoteJid, {
      text: text,
      mentions: singleMentions
    }, { quoted: msg });
  }
}
