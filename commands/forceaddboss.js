import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'forceaddboss',
  aliases: ['forceadd'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, isGroup, senderJid, prefix } = context;

    if (!isGroup) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Este comando só pode ser usado dentro de um grupo.`
      }, { quoted: msg });
      return;
    }

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}forceaddboss ferumbras\``
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

    let participants;
    try {
      const metadata = await sock.groupMetadata(remoteJid);
      participants = metadata.participants.map(p => p.id);
    } catch (err) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Não foi possível obter os membros do grupo.`
      }, { quoted: msg });
      return;
    }

    const results = await Promise.all(
      participants.map(jid => db.addSubscription(jid, bossName))
    );

    const added = results.filter(Boolean).length;
    const already = results.length - added;

    let text = `✅ *${bossName}* adicionado para *${added} membro(s)* do grupo!`;
    if (already > 0) text += `\nℹ️ ${already} já estavam inscritos.`;

    await sock.sendMessage(remoteJid, { text }, { quoted: msg });
  }
}
