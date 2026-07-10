import * as db from '../database.js';

export default {
  name: 'addcommunity',
  aliases: ['addcomunity'],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid, senderJid } = context;
    if (!isGroup) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo ou comunidade.` }, { quoted: msg });
      return;
    }
    
    const communities = await db.getAllowedCommunities();
    
    const success = await db.addCommunity(remoteJid);
    if (success || communities.includes(remoteJid)) {
      await sock.sendMessage(remoteJid, { text: `✅ Grupo/Comunidade vinculada com sucesso para receber alertas!` }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Falha ao vincular a comunidade.` }, { quoted: msg });
    }
  }
}
