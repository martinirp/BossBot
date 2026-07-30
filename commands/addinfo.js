import fs from 'fs';
import path from 'path';
import { normalizeBossName, findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'addinfo',
  aliases: ['addextrainfo', 'infoextra', 'add'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix, withoutPrefix } = context;

    // Se usou o alias "add", verifica se o começo é "extra info"
    let fullText = withoutPrefix.trim();
    if (fullText.toLowerCase().startsWith('add extra info')) {
        fullText = fullText.substring('add extra info'.length).trim();
    } else if (fullText.toLowerCase().startsWith('addinfo')) {
        fullText = fullText.substring('addinfo'.length).trim();
    } else if (fullText.toLowerCase().startsWith('addextrainfo')) {
        fullText = fullText.substring('addextrainfo'.length).trim();
    } else if (fullText.toLowerCase().startsWith('add')) {
        fullText = fullText.substring('add'.length).trim();
    }

    if (fullText.startsWith(',')) fullText = fullText.substring(1).trim();

    const parts = fullText.split(',');
    if (parts.length < 2) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Formato incorreto. Use: *${prefix}addinfo BOSS, INFO*\nExemplo: *${prefix}addinfo Ferumbras, Nasce no topo da torre*`
      }, { quoted: msg });
      return;
    }

    const bossRaw = parts[0].trim();
    const infoText = parts.slice(1).join(',').trim();

    if (!bossRaw || !infoText) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Formato incorreto. Use: *${prefix}addinfo BOSS, INFO*`
      }, { quoted: msg });
      return;
    }

    const bossesList = loadBosses();
    const matchResult = findBossMatch(bossRaw, bossesList);

    if (!matchResult.match) {
      if (matchResult.suggestions.length > 0) {
        const suggestionsStr = matchResult.suggestions.map(s => `*${s}*`).join(', ');
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não foi encontrado. Você quis dizer: ${suggestionsStr}?`
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não foi encontrado. Verifique a grafia.`
        }, { quoted: msg });
      }
      return;
    }

    const matchedBossName = matchResult.match;
    const statsPath = path.resolve('boss_stats.json');
    
    let stats = {};
    if (fs.existsSync(statsPath)) {
      stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    }

    if (!stats[matchedBossName]) {
      stats[matchedBossName] = { hp: '?', immunities: [] };
    }

    stats[matchedBossName].extra_info = infoText;

    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');

    await sock.sendMessage(remoteJid, {
      text: `✅ Informação extra adicionada para *${matchedBossName}*:\n_${infoText}_`
    }, { quoted: msg });
  }
};
