import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

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
    const record = await db.getBossLastSeen(bossName);

    if (!record) {
      await sock.sendMessage(remoteJid, {
        text: `⚔️ *${bossName}*\n\n📭 Nenhum avistamento registrado ainda.`
      }, { quoted: msg });
      return;
    }

    const phone = record.confirmed_by.split('@')[0];
    await sock.sendMessage(remoteJid, {
      text: `⚔️ *${bossName}*\n\n👁️ Último avistamento: *${record.seen_at}*\n👤 Por: @${phone}`,
      mentions: [record.confirmed_by]
    }, { quoted: msg });
  }
}
