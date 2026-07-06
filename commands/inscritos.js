import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'inscritos',
  aliases: ['subscribers', 'quemquer', 'inscritos', 'subs', 'i'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}inscritos ferumbras\``
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
    const subscribers = await db.getSubscribers(bossName);

    if (subscribers.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `📭 Nenhum membro inscrito em *${bossName}* no momento.`
      }, { quoted: msg });
      return;
    }

    // Busca os nomes de todos os inscritos sem mencionar ninguém
    const nameMap = await db.getAllUserNames();

    const lines = subscribers.map((jid, i) => {
      const phone = jid.split('@')[0];
      const name = nameMap[jid] || phone;
      return `${i + 1}. ${name}`;
    });

    const text = `👥 *Inscritos em ${bossName}* (${subscribers.length}):\n\n${lines.join('\n')}`;

    await sock.sendMessage(remoteJid, { text }, { quoted: msg });
  }
};
