import fs from 'fs';
import path from 'path';
import { loadBosses, findBossMatch } from '../commands.js';

export default {
  name: 'removenewboss',
  aliases: ['removenew', 'deletenewboss', 'removerboss'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss a ser removido.\nExemplo: \`${prefix}removenewboss White Pale\``
      }, { quoted: msg });
      return;
    }

    const bossInput = args.join(' ').trim().replace(/\s+/g, ' ');
    const bossesList = loadBosses();
    const matchResult = findBossMatch(bossInput, bossesList);

    if (matchResult.match) {
      const matchedBoss = matchResult.match;
      
      // Remove o boss da lista
      const updatedList = bossesList.filter(boss => boss !== matchedBoss);

      const filePath = path.resolve('bosses.json');
      try {
        fs.writeFileSync(filePath, JSON.stringify(updatedList, null, 2), 'utf-8');
        await sock.sendMessage(remoteJid, {
          text: `✅ Boss *${matchedBoss}* removido com sucesso da lista!`
        }, { quoted: msg });
      } catch (err) {
        console.error('[removenewboss] Failed to write bosses.json:', err);
        await sock.sendMessage(remoteJid, {
          text: `❌ Ocorreu um erro ao salvar a lista atualizada no arquivo bosses.json.`
        }, { quoted: msg });
      }
    } else {
      if (matchResult.suggestions && matchResult.suggestions.length > 0) {
        const s = matchResult.suggestions.map(b => `*${b}*`).join(', ');
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossInput}* não encontrado. Você quis dizer: ${s}?`
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `❌ Boss *${bossInput}* não encontrado na lista.`
        }, { quoted: msg });
      }
    }
  }
}
