import * as db from '../database.js';

export default {
  name: 'removecommunity',
  aliases: ['removecomunity'],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid, senderJid } = context;
    if (!isGroup) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo ou comunidade.` }, { quoted: msg });
      return;
    }

    const success = await db.removeCommunity(remoteJid);
    if (success) {
      await sock.sendMessage(remoteJid, { text: `❌ Grupo/Comunidade removida da lista de alertas.` }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Falha ao remover a comunidade ou ela não estava vinculada.` }, { quoted: msg });
    }
  }
}
