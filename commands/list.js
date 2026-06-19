import * as db from '../database.js';

export default {
  name: 'list',
  aliases: ['meusbosses'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;
    const list = await db.getBossSubscriptionsForJid(senderJid);
    if (list.length > 0) {
      const listStr = list.map(b => `- *${b}*`).join('\n');
      await sock.sendMessage(remoteJid, {
        text: `📋 @${senderPhone}, você está inscrito nos seguintes bosses:\n${listStr}`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `📋 @${senderPhone}, você não está inscrito em nenhum boss.`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
  }
}
