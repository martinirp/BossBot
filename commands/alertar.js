export default {
  name: 'alertar',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    await sock.sendMessage(remoteJid, {
      text: `tudo bem.! anotado!`
    }, { quoted: msg });
  }
};
