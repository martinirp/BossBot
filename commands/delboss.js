import * as db from '../database.js';
import { findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'delboss',
  aliases: ['remover', 'limpar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix } = context;
    if (args.length === 0) {
        await sock.sendMessage(remoteJid, {
            text: `⚠️ @${senderPhone}, para limpar as inscrições de um boss específico, use:\n*${prefix}delboss <nome do boss>* (Ex: \`${prefix}delboss ferumbras\`)\n\nPara limpar TODAS as suas inscrições de bosses de uma vez, use:\n*${prefix}delall*`,
            mentions: [senderJid]
        }, { quoted: msg });
        return;
    }

    const inputString = args.join(' ');
    const bossesList = loadBosses();
    const successList = [];
    const notSubbedList = [];
    const notFoundList = [];

    const originalParts = inputString.split(',');
    for (const bossInput of originalParts) {
      if(!bossInput.trim()) continue;
      const matchResult = findBossMatch(bossInput, bossesList);
      if (matchResult.match) {
        const success = await db.removeSubscription(senderJid, matchResult.match);
        if (success) successList.push(matchResult.match);
        else notSubbedList.push(matchResult.match);
      } else {
        notFoundList.push(bossInput.trim());
      }
    }

    let responseText = ``;
    if (successList.length > 0) responseText += `❌ Removido: ${successList.map(b => `*${b}*`).join(', ')}\n`;
    if (notSubbedList.length > 0) responseText += `⚠️ Não estava inscrito: ${notSubbedList.map(b => `*${b}*`).join(', ')}\n`;
    if (notFoundList.length > 0) responseText += `❌ Não encontrado: ${notFoundList.map(b => `*${b}*`).join(', ')}\n`;
    
    if(responseText) {
        await sock.sendMessage(remoteJid, {
            text: `@${senderPhone}\n${responseText.trim()}`,
            mentions: [senderJid]
        }, { quoted: msg });
    }
  }
}
