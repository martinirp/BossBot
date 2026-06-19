import * as db from '../database.js';

export default {
  name: 'pushover',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix } = context;
    
    if (args.length === 0) {
      const key = await db.getUserPushoverKey(senderJid);
      if (key) {
        const maskedKey = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        await sock.sendMessage(remoteJid, {
          text: `📋 @${senderPhone}, seu Pushover User Key cadastrado é: *${maskedKey}*`,
          mentions: [senderJid]
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `📋 @${senderPhone}, você não possui nenhuma chave do Pushover cadastrada. Cadastre com *${prefix}pushover <sua_chave>*`,
          mentions: [senderJid]
        }, { quoted: msg });
      }
      return;
    }

    const arg = args[0].toLowerCase();
    if (arg === 'remover' || arg === 'limpar') {
      const success = await db.removeUserPushoverKey(senderJid);
      if (success) {
        await sock.sendMessage(remoteJid, {
          text: `❌ @${senderPhone}, seu Pushover User Key foi removido com sucesso!`,
          mentions: [senderJid]
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ @${senderPhone}, você não possui uma chave do Pushover cadastrada.`,
          mentions: [senderJid]
        }, { quoted: msg });
      }
      return;
    }

    const key = args[0];
    const success = await db.setUserPushoverKey(senderJid, key);
    if (success) {
      await sock.sendMessage(remoteJid, {
        text: `✅ @${senderPhone}, seu Pushover User Key foi cadastrado com sucesso!`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ @${senderPhone}, ocorreu um erro ao salvar seu Pushover User Key.`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
  }
}
