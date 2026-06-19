import * as db from '../database.js';

export default {
  name: 'delall',
  aliases: ['limparbosses', 'clear'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;
    const removedCount = await db.clearSubscriptionsForJid(senderJid);
    if (removedCount > 0) {
      await sock.sendMessage(remoteJid, {
        text: `🧹 @${senderPhone}, suas inscrições foram limpas! Você foi desinscrito de ${removedCount} boss(es).`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `🧹 @${senderPhone}, você não possui nenhuma inscrição de boss para limpar.`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
  }
}
