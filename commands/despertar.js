export default {
  name: 'despertar',
  aliases: ['acordar', 'alertar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, withoutPrefix } = context;

    // Obtém o verbo exato usado pelo usuário (despertar, acordar ou alertar)
    const verbUsed = withoutPrefix.split(/\s+/)[0].toLowerCase();
    
    // Une o restante da mensagem enviada
    const restText = args.join(' ');

    // Responde confirmando dinamicamente
    const responseText = `certo, vou ${verbUsed} ${restText}`.trim();
    await sock.sendMessage(remoteJid, {
      text: responseText
    }, { quoted: msg });
  }
};
