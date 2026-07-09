import * as db from '../database.js';

export default {
  name: 'removecommunity',
  aliases: ['removecomunity'],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid, senderIsAdmin } = context;
    if (!isGroup) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo ou comunidade.` }, { quoted: msg });
      return;
    }

    const ownerNumber = process.env.BOT_OWNER_NUMBER;
    const isOwner = ownerNumber && msg.key.participant && msg.key.participant.includes(ownerNumber);
    if (!senderIsAdmin && !isOwner) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Somente administradores podem desvincular a comunidade.` }, { quoted: msg });
      return;
    }

    const success = await db.removeCommunity(remoteJid);
    if (success) {
      await sock.sendMessage(remoteJid, { text: `✅ Comunidade desvinculada com sucesso!` }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Esta comunidade não estava vinculada.` }, { quoted: msg });
    }
  }
}
