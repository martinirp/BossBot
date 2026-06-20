import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'check',
  aliases: ['checar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}check ferumbras\``
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
    await db.updateBossCheck(bossName, senderJid);

    const now = new Date();
    now.setHours(now.getHours() - 3);
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    await sock.sendMessage(remoteJid, {
      text: `🔍 *${bossName}*\n\n✅ Check registrado por @${senderPhone} às *${timeString}*\n❌ Boss não estava no spawn.`,
      mentions: [senderJid]
    }, { quoted: msg });
  }
}
