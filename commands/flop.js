import * as db from '../database.js';
import { findBossMatch, normalizeBossName, loadBosses, getBossCities, CITY_ALIASES } from '../commands.js';
import { calcTrackingDay } from './confirm.js';

export default {
  name: 'flop',
  aliases: ['floop'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;
    if (args.length === 0) return;

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

    // Checagem de boss multi-cidades
    const validCities = getBossCities(matchedBossName);
    let matchedCity = null;
    let finalExtraText = extraText;
    let cityBossName = matchedBossName;

    if (validCities) {
      if (!extraText.trim()) {
        // Exibe menu numérico igual ao !boss, mas sem disparar notificações
        let menuText = `⚔️ Boss Flopado: ${matchedBossName.toUpperCase()}! ⚔️\n`;
        menuText += `Responda a esta mensagem APENAS com o NÚMERO do local:\n`;

        const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        validCities.forEach((city, idx) => {
          const emoji = NUM_EMOJIS[idx] || `*${idx + 1}.*`;
          menuText += `${emoji} ${city}\n`;
        });

        const menuMsg = await sock.sendMessage(remoteJid, {
          text: menuText.trim(),
          mentions: [senderJid]
        }, { quoted: msg });

        context.commandHandler.activePolls.set(menuMsg.key.id, {
          type: 'numeric_menu',
          command: 'flop',
          bossName: matchedBossName,
          cities: validCities,
          prefix: context.prefix,
          remoteJid: remoteJid
        });

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
            const cityLen = matchedPrefix.length;
            let remaining = extraText.substring(cityLen).trim();
            if (remaining.startsWith('-') || remaining.startsWith(',') || remaining.startsWith('|')) {
              remaining = remaining.substring(1).trim();
            }
            finalExtraText = remaining;
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
    const utcNow = new Date();
    const { seenAt, trackingDateStr, apiUpdatedTonight, brtTimeStr } = await calcTrackingDay(utcNow, world);

    // Salva o avistamento com o confirmador 'flop'
    await db.setBossLastSeenDate(cityBossName, 'flop', seenAt, world, matchedCity);
    
    // Adiciona o relatório de flop no histórico
    await db.addBossReport(cityBossName, 'Flopado', 'flop', 0, world);

    let bossHeader = `⚔️ *${matchedBossName.toUpperCase()}*`;
    if (matchedCity) {
      bossHeader = `⚔️ *${matchedBossName.toUpperCase()}* (${matchedCity})`;
    }

    await sock.sendMessage(remoteJid, {
      text: `📉 *BOSS FLOPADO\n${bossHeader}\n🕒 Registrado às: ${brtTimeStr}\n📌 Ciclo de nascimento reiniciado!`,
    }, { quoted: msg });
  }
};
