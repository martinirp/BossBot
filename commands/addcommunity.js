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
    
    // For @newsletter (Community Announcement Groups), skip admin check - just allow the command
    const isNewsletter = remoteJid.endsWith('@newsletter');

    // Check if sender is admin or owner
    let senderIsAdmin = isNewsletter; // newsletters skip group admin check
    if (!isNewsletter) {
      try {
        const metadata = await sock.groupMetadata(remoteJid);
        const participant = metadata.participants.find(p => p.id === senderJid);
        senderIsAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
      } catch (err) {
        console.error('Failed to get metadata for admin check:', err);
      }
    }

    const ownerNumber = process.env.BOT_OWNER_NUMBER;
    const isOwner = ownerNumber && msg.key.participant && msg.key.participant.includes(ownerNumber);
    if (!senderIsAdmin && !isOwner) {
      await sock.sendMessage(remoteJid, { text: `⚠️ Somente administradores podem vincular este grupo como comunidade.` }, { quoted: msg });
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
