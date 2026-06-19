export default {
  name: 'groupid',
  aliases: ['idgrupo'],
  execute: async (context, args) => {
    const { sock, msg, isGroup, remoteJid } = context;
    if (isGroup) {
      await sock.sendMessage(remoteJid, {
        text: `ℹ️ O ID deste grupo é:\n*${remoteJid}*`
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Este comando só funciona se for enviado dentro de um grupo.`
      }, { quoted: msg });
    }
  }
}
