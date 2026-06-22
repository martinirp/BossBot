import * as db from '../database.js';

export default {
  name: 'setworld',
  aliases: ['definirmundo', 'mundo'],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid } = context;

    if (!isGroup) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Este comando só pode ser utilizado dentro de um grupo.`
      }, { quoted: msg });
      return;
    }

    if (args.length === 0) {
      const currentWorld = await db.getGroupWorld(remoteJid);
      await sock.sendMessage(remoteJid, {
        text: `🌍 Este grupo está configurado para rastrear o mundo: *${currentWorld}*\n👉 Para mudar, use: \`!setworld <NomeDoMundo>\``
      }, { quoted: msg });
      return;
    }

    const worldInput = args[0].trim();
    // Capitalize correctly (e.g. antica -> Antica)
    const worldName = worldInput.charAt(0).toUpperCase() + worldInput.slice(1).toLowerCase();

    const success = await db.setGroupWorld(remoteJid, worldName);

    if (success) {
      await sock.sendMessage(remoteJid, {
        text: `✅ Este grupo agora está configurado para rastrear o mundo: *${worldName}*`
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Não foi possível alterar o mundo do grupo. Certifique-se de que o grupo está vinculado ao bot (use \`!addgroup\`).`
      }, { quoted: msg });
    }
  }
};
