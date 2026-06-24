import * as db from '../database.js';
import { findBossMatch, loadBosses, normalizeBossName, getBossCities, CITY_ALIASES } from '../commands.js';

export default {
  name: 'check',
  aliases: ['checar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}check ferumbras\``
      }, { quoted: msg });
      return;
    }

    const rest = args.join(' ');
    let bossRaw = rest;
    let extraText = '';

    const commaIndex = rest.indexOf(',');
    const pipeIndex = rest.indexOf('|');
    let separatorIndex = -1;
    if (commaIndex !== -1 && pipeIndex !== -1) {
      separatorIndex = Math.min(commaIndex, pipeIndex);
    } else {
      separatorIndex = commaIndex !== -1 ? commaIndex : pipeIndex;
    }

    if (separatorIndex !== -1) {
      bossRaw = rest.substring(0, separatorIndex).trim();
      extraText = rest.substring(separatorIndex + 1).trim();
    }

    const bossName = normalizeBossName(bossRaw);
    if (!bossName) return;

    const bossesList = loadBosses();
    const matchResult = findBossMatch(bossRaw, bossesList);

    if (!matchResult.match) {
      if (matchResult.suggestions.length > 0) {
        const s = matchResult.suggestions.map(b => `*${b}*`).join(', ');
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado. Você quis dizer: ${s}?`
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado.`
        }, { quoted: msg });
      }
      return;
    }

    const matchedBossName = matchResult.match;

    // Checagem de boss multi-cidades
    const validCities = getBossCities(matchedBossName);
    let matchedCity = null;
    let cityBossName = matchedBossName;

    if (validCities) {
      if (!extraText.trim()) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ O boss *${matchedBossName}* nasce em várias cidades. Por favor, especifique a cidade como argumento.\nExemplo: \`${context.prefix}check ${matchedBossName}, Ankrahmun\`\nCidades válidas: ${validCities.join(', ')}`
        }, { quoted: msg });
        return;
      }

      const normalizedExtra = normalizeBossName(extraText);
      for (const city of validCities) {
        const normalizedCity = normalizeBossName(city);
        const aliases = Object.keys(CITY_ALIASES).filter(key => CITY_ALIASES[key] === city);
        const candidates = [normalizedCity, ...aliases];
        
        let matched = false;
        let matchedPrefix = null;
        for (const candidate of candidates) {
          if (normalizedExtra.startsWith(candidate)) {
            matched = true;
            matchedPrefix = candidate;
            break;
          }
        }

        if (matched) {
          const hasBoundary = normalizedExtra.length === matchedPrefix.length || 
                              !/^[a-z0-9]$/i.test(normalizedExtra[matchedPrefix.length]);
          if (hasBoundary) {
            matchedCity = city;
            break;
          }
        }
      }

      if (!matchedCity) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ A cidade informada não é válida para o boss *${matchedBossName}*.\nCidades válidas: ${validCities.join(', ')}.`
        }, { quoted: msg });
        return;
      }

      cityBossName = `${matchedBossName} (${matchedCity})`;
    }

    const world = await db.getGroupWorld(remoteJid);
    await db.updateBossCheck(cityBossName, senderJid, world, matchedCity);

    const now = new Date();
    now.setHours(now.getHours() - 3);
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let checkHeader = `🔍 *${matchedBossName}*`;
    if (matchedCity) {
      checkHeader = `🔍 *${matchedBossName}* (${matchedCity})`;
    }

    await sock.sendMessage(remoteJid, {
      text: `${checkHeader}\n\n✅ Check registrado por @${senderPhone} às *${timeString}*\n❌ Boss não estava no spawn.`,
      mentions: [senderJid]
    }, { quoted: msg });
  }
}
