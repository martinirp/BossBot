export default {
  name: 'despertar',
  aliases: ['acordar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, withoutPrefix } = context;

    // Obtém o verbo exato usado pelo usuário (despertar ou acordar)
    const verbUsed = withoutPrefix.split(/\s+/)[0].toLowerCase();
    
    // Une o restante da mensagem enviada
    const restText = args.join(' ');

    if (!restText) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Por favor, digite o que deseja ${verbUsed}.\nExemplo: *!${verbUsed} coruja às 3 da manhã*`
      }, { quoted: msg });
      return;
    }

    // Responde confirmando dinamicamente
    await sock.sendMessage(remoteJid, {
      text: `certo, vou ${verbUsed} ${restText}`
    }, { quoted: msg });
  }
};
