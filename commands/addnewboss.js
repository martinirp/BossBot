import fs from 'fs';
import path from 'path';
import { loadBosses, normalizeBossName } from '../commands.js';

export default {
  name: 'addnewboss',
  aliases: ['newboss', 'novoboss', 'criarboss'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do novo boss.\nExemplo: \`${prefix}addnewboss White Pale\``
      }, { quoted: msg });
      return;
    }

    const newBossName = args.join(' ').trim().replace(/\s+/g, ' ');
    const normalizedNew = normalizeBossName(newBossName);

    if (!normalizedNew) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ O nome do boss é inválido.`
      }, { quoted: msg });
      return;
    }

    const bossesList = loadBosses();
    
    // Verifica se já existe
    const exists = bossesList.some(boss => normalizeBossName(boss) === normalizedNew);
    if (exists) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ O boss *${newBossName}* já existe na lista!`
      }, { quoted: msg });
      return;
    }

    // Adiciona ao final da lista
    bossesList.push(newBossName);

    const filePath = path.resolve('bosses.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(bossesList, null, 2), 'utf-8');
      await sock.sendMessage(remoteJid, {
        text: `✅ Boss *${newBossName}* adicionado com sucesso à lista!`
      }, { quoted: msg });
    } catch (err) {
      console.error('[addnewboss] Failed to write bosses.json:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Ocorreu um erro ao salvar o novo boss no arquivo bosses.json.`
      }, { quoted: msg });
    }
  }
}
