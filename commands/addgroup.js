import * as db from '../database.js';

export default {
  name: 'addgroup',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid, allowedGroups } = context;
    if (!isGroup) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo.` }, { quoted: msg });
      return;
    }
    const maxGroups = parseInt(process.env.MAX_ALLOWED_GROUPS || '1', 10);
    if (allowedGroups.length >= maxGroups && !allowedGroups.includes(remoteJid)) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Não é possível vincular este grupo no momento.` }, { quoted: msg });
      return;
    }
    const success = await db.addGroup(remoteJid);
    if (success || allowedGroups.includes(remoteJid)) {
      await sock.sendMessage(remoteJid, { text: `✅ Bot vinculado a este grupo com sucesso!` }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Falha ao vincular o grupo.` }, { quoted: msg });
    }
  }
}
