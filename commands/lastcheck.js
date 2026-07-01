import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities } from '../commands.js';

// Helper to format seen_at timestamp from German time to BRT "DD/MM/YYYY HH:mm"
const formatSeenAtBrt = (seenAtStr) => {
  if (!seenAtStr) return 'Nenhum registro';
  const germanDate = db.parseDateStr(seenAtStr);
  if (!germanDate) return seenAtStr;
  const brtDate = db.utcToBrt(db.germanToUtc(germanDate));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
};

export default {
  name: 'lastcheck',
  aliases: ['ultimocheck', 'últimocheck', 'uc'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}lastcheck ferumbras\``
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
      let text = `🔍 *${bossName}*\n\n`;
      const mentions = [];
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        const [checkRecord, lastSeenRecord] = await Promise.all([
          db.getBossCheck(cityBossName, world),
          db.getBossLastSeen(cityBossName, world)
        ]);
        
        text += `📍 *${city}*:\n`;
        if (checkRecord) {
          const phone = checkRecord.checked_by.split('@')[0];
          text += `🕵️ Último check: *${formatSeenAtBrt(checkRecord.checked_at)}* por @${phone}\n`;
          if (checkRecord.checked_by.includes('@')) mentions.push(checkRecord.checked_by);
        } else {
          text += `🕵️ Último check: Nenhum registro\n`;
        }
        
        if (lastSeenRecord) {
          const phone = lastSeenRecord.confirmed_by.split('@')[0];
          text += `⚔️ Último avistamento: *${formatSeenAtBrt(lastSeenRecord.seen_at)}* por @${phone}\n`;
          if (lastSeenRecord.confirmed_by.includes('@')) mentions.push(lastSeenRecord.confirmed_by);
        } else {
          text += `⚔️ Último avistamento: Nenhum registro\n`;
        }
        text += '\n';
      }
      
      await sock.sendMessage(remoteJid, {
        text: text.trim(),
        mentions: [...new Set(mentions)]
      }, { quoted: msg });
      return;
    }

    const [checkRecord, lastSeenRecord] = await Promise.all([
      db.getBossCheck(bossName, world),
      db.getBossLastSeen(bossName, world)
    ]);

    let text = `🔍 *${bossName}*\n\n`;

    if (checkRecord) {
      const phone = checkRecord.checked_by.split('@')[0];
      text += `🕵️ Último check: *${formatSeenAtBrt(checkRecord.checked_at)}*\n👤 Por: @${phone}\n❌ Boss não estava lá\n`;
    } else {
      text += `🕵️ Último check: Nenhum registro\n`;
    }

    text += '\n';

    if (lastSeenRecord) {
      const phone = lastSeenRecord.confirmed_by.split('@')[0];
      text += `⚔️ Último avistamento: *${formatSeenAtBrt(lastSeenRecord.seen_at)}*\n👤 Por: @${phone}`;
    } else {
      text += `⚔️ Último avistamento: Nenhum registro`;
    }

    const mentions = [];
    if (checkRecord && checkRecord.checked_by.includes('@')) mentions.push(checkRecord.checked_by);
    if (lastSeenRecord && lastSeenRecord.confirmed_by.includes('@')) mentions.push(lastSeenRecord.confirmed_by);

    await sock.sendMessage(remoteJid, {
      text: text.trim(),
      mentions: [...new Set(mentions)]
    }, { quoted: msg });
  }
}
