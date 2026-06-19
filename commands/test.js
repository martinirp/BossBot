import { getUserPushoverKey } from '../database.js';
import { sendPushoverMessage } from '../notifier.js';
import dotenv from 'dotenv';
dotenv.config();

export default {
  name: 'test',
  aliases: ['teste'],
  execute: async (context, args) => {
    const { sock, remoteJid, senderJid, senderPhone, msg } = context;
    
    const globalToken = process.env.PUSHOVER_TOKEN;
    if (!globalToken) {
      await sock.sendMessage(remoteJid, { text: `⚠️ O bot não possui um token global do Pushover configurado.` }, { quoted: msg });
      return;
    }

    const userKey = await getUserPushoverKey(senderJid);
    if (!userKey) {
      await sock.sendMessage(remoteJid, { text: `⚠️ @${senderPhone}, você não possui uma chave do Pushover vinculada. Cadastre com *!pushover <sua_chave>*`, mentions: [senderJid] }, { quoted: msg });
      return;
    }

    await sock.sendMessage(remoteJid, { text: `✅ @${senderPhone}, enviando uma notificação de teste para o seu Pushover...`, mentions: [senderJid] }, { quoted: msg });
    
    try {
      await sendPushoverMessage(globalToken, userKey, "Esta é uma notificação de teste do BossBot!", "BossBot Teste", 1);
    } catch (err) {
      console.error('Erro ao enviar teste pushover:', err);
      await sock.sendMessage(remoteJid, { text: `❌ @${senderPhone}, falha ao enviar o teste para o seu Pushover. Verifique sua chave.`, mentions: [senderJid] }, { quoted: msg });
    }
  }
}
