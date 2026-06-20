import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

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

    const [checkRecord, lastSeenRecord] = await Promise.all([
      db.getBossCheck(bossName),
      db.getBossLastSeen(bossName)
    ]);

    let text = `🔍 *${bossName}*\n\n`;

    if (checkRecord) {
      const phone = checkRecord.checked_by.split('@')[0];
      text += `🕵️ Último check: *${checkRecord.checked_at}*\n👤 Por: @${phone}\n❌ Boss não estava lá\n`;
    } else {
      text += `🕵️ Último check: Nenhum registro\n`;
    }

    text += '\n';

    if (lastSeenRecord) {
      const phone = lastSeenRecord.confirmed_by.split('@')[0];
      text += `⚔️ Último avistamento: *${lastSeenRecord.seen_at}*\n👤 Por: @${phone}`;
    } else {
      text += `⚔️ Último avistamento: Nenhum registro`;
    }

    const mentions = [];
    if (checkRecord) mentions.push(checkRecord.checked_by);
    if (lastSeenRecord) mentions.push(lastSeenRecord.confirmed_by);

    await sock.sendMessage(remoteJid, {
      text: text.trim(),
      mentions: [...new Set(mentions)]
    }, { quoted: msg });
  }
}
