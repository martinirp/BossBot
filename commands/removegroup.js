import * as db from '../database.js';

export default {
  name: 'removegroup',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid } = context;
    if (!isGroup) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo.` }, { quoted: msg });
      return;
    }
    const success = await db.removeGroup(remoteJid);
    if (success) {
      await sock.sendMessage(remoteJid, { text: `❌ Bot desvinculado deste grupo com sucesso.` }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este grupo já não estava vinculado.` }, { quoted: msg });
    }
  }
}
