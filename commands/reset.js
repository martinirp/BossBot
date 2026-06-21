import * as db from '../database.js';

export default {
  name: 'reset',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;

    const allowedNumbers = ['553299686584', '5532999686584'];
    if (!allowedNumbers.includes(senderPhone)) {
       await sock.sendMessage(remoteJid, {
         text: `⚠️ Somente o administrador pode reiniciar o bot.`
       }, { quoted: msg });
       return;
    }

    console.log(`[SYSTEM] Reset command received from ${senderPhone}. Restarting bot...`);
    await sock.sendMessage(remoteJid, {
      text: `🔄 Reiniciando o bot a pedido de @${senderPhone}...`,
      mentions: [senderJid]
    }, { quoted: msg });

    setTimeout(async () => {
      try {
        await db.closeDb();
      } catch (err) {
        console.error('Error closing DB during reset:', err);
      }
      console.log('[SYSTEM] Exiting process for restart.');
      process.exit(0);
    }, 1500);
  }
}
