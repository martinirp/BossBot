import * as db from '../database.js';
import { loadBosses } from '../commands.js';

export default {
  name: 'addall',
  aliases: ['todos'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;
    const bossesList = loadBosses();
    const promises = bossesList.map(boss => db.addSubscription(senderJid, boss));
    await Promise.all(promises);
    await sock.sendMessage(remoteJid, {
      text: `✅ @${senderPhone}, você foi inscrito em TODOS os ${bossesList.length} bosses com sucesso!`,
      mentions: [senderJid]
    }, { quoted: msg });
  }
}
