import * as db from '../database.js';

export default {
  name: 'hive',
  aliases: ['lasthive', 'hiveboss'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    const lastHiveStr = await db.getGlobalSetting('last_hive');
    if (!lastHiveStr) {
      await sock.sendMessage(remoteJid, {
        text: `*Hive*\n\nNenhuma hive registrada recentemente.`
      }, { quoted: msg });
      return;
    }

    try {
      const hiveData = JSON.parse(lastHiveStr);
      const text = `${hiveData.response}\n\n👤 Enviado por: @${hiveData.reportedBy} em *${hiveData.savedAt}*`;
      await sock.sendMessage(remoteJid, {
        text: text,
        mentions: [`${hiveData.reportedBy}@s.whatsapp.net`]
      }, { quoted: msg });
    } catch (err) {
      // Fallback in case of parse issues
      await sock.sendMessage(remoteJid, {
        text: lastHiveStr
      }, { quoted: msg });
    }
  }
};
