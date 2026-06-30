import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities, loadLocations, getLinkForCity } from '../commands.js';
import fs from 'fs';
import path from 'path';

const loadIntervals = () => {
  try {
    const jsonPath = path.resolve('boss_intervals.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error('[info] Error loading boss_intervals.json:', err);
    return {};
  }
};

// loadLocations imported from commands.js

const loadStats = () => {
  try {
    const jsonPath = path.resolve('boss_stats.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    return {};
  }
};

// Helper to format seen_at timestamp from "YYYY-MM-DD HH:mm" to "DD/MM/YYYY HH:mm"
const formatSeenAt = (seenAtStr) => {
  if (!seenAtStr) return 'Nenhum avistamento registrado ainda';
  const parts = seenAtStr.split(' ');
  if (parts.length !== 2) return seenAtStr;
  const dateParts = parts[0].split('-');
  if (dateParts.length !== 3) return seenAtStr;
  return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${parts[1]}`;
};

// Helper to format Date in "fake UTC" (matching Brazil timezone digits) to "DD/MM/YYYY HH:mm"
const formatFakeUtcDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(date.getUTCDate());
  const month = pad(date.getUTCMonth() + 1);
  const year = date.getUTCFullYear();
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

// Calculates prediction based on seenDate, minDays, and maxDays
const calculatePrediction = (seenAtStr, minDays, maxDays, confirmedBy) => {
  const datePart = seenAtStr.split(' ')[0]; // "YYYY-MM-DD"
  const seenDate = new Date(datePart + 'T03:00:00Z');

  const shiftMinMs = confirmedBy === 'TibiaData_API' ? -24 * 60 * 60 * 1000 : 0;
  const minDate = new Date(seenDate.getTime() + minDays * 24 * 60 * 60 * 1000 + shiftMinMs);
  const maxDate = new Date(seenDate.getTime() + maxDays * 24 * 60 * 60 * 1000);
  
  const today = new Date();

  let predictionStr = "";
  if (minDays === maxDays) {
    predictionStr = `A cada ${minDays} dia(s)`;
  } else {
    predictionStr = `Entre ${formatFakeUtcDate(minDate)} e ${formatFakeUtcDate(maxDate)}`;
  }
  
  let extraStr = "";
  if (minDays !== maxDays) {
    if (today >= maxDate) {
      extraStr = " (🟢 No radar / 🟢 Alta chance)";
    } else if (today >= minDate) {
      extraStr = " (🟢 No radar / 🟢 Com chance)";
    } else {
      extraStr = " (🔴 Fora do radar / 🔴 Sem chance)";
    }
  }
  return predictionStr + extraStr;
};

// getLinkForCity imported from commands.js

// Helper to format the boss details block
const formatBossInfo = async (bossName, intervalName, record) => {
  const bossIntervals = loadIntervals();
  const interval = bossIntervals[intervalName];
  let spawnIntervalLine = '';
  let predictionText = 'Indefinida (necessita de um avistamento prévio)';

  if (interval && interval.fixedDaysFrequency) {
    const min = interval.fixedDaysFrequency.min;
    const max = interval.fixedDaysFrequency.max;
    
    if (min === max) {
      spawnIntervalLine = `📅 *Nasce a cada:* ${min} dia(s)\n`;
    } else {
      spawnIntervalLine = `📅 *Nasce de:* ${min} a ${max} dias\n`;
    }

    if (record && record.seen_at) {
      predictionText = calculatePrediction(record.seen_at, min, max, record.confirmed_by);
    }
  } else {
    spawnIntervalLine = `📅 *Nasce de:* Sem intervalo de spawn cadastrado\n`;
    predictionText = 'Sem previsão disponível';
  }

  let text = '';
  if (record && record.seen_at) {
    const confirmer = record.confirmed_by;
    if (confirmer === 'TibiaData_API') {
      text += `👁️ *Visto:* ${formatSeenAt(record.seen_at)} (por TibiaData API)\n`;
    } else {
      text += `👁️ *Visto:* ${formatSeenAt(record.seen_at)}\n`;
    }
  } else {
    text += `👁️ *Visto:* Nenhum avistamento registrado ainda\n`;
  }

  text += spawnIntervalLine;
  text += `🔮 *Previsão:* ${predictionText}\n`;

  const recentTimes = await db.getBossRecentTimes(intervalName);
  if (recentTimes && recentTimes.length > 0) {
    text += `⏰ *Últimos horários de morte:* ${recentTimes.join(', ')}\n`;
  }

  const bossLocations = loadLocations();
  const locations = bossLocations[bossName] || [];
  if (locations.length > 0) {
    let city = null;
    const match = intervalName.match(/\(([^)]+)\)/);
    if (match) {
      city = match[1];
    }

    if (city) {
      const link = getLinkForCity(bossName, locations, city);
      if (link) {
        text += `🗺️ *Mapa:* ${link}\n`;
      }
    } else {
      const links = locations.map(l => l.link);
      text += `🗺️ *Mapa:* ${links.join(', ')}\n`;
    }
  }

  return { text, confirmedBy: record ? record.confirmed_by : null };
};

export default {
  name: 'info',
  aliases: ['bossinfo', 'statusboss'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}info ferumbras\``
      }, { quoted: msg });
      return;
    }

    const bossRaw = args.join(' ');
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

    const bossName = matchResult.match;
    const world = await db.getGroupWorld(remoteJid);
    const cities = getBossCities(bossName);
    const mentions = [];

    const bossStats = loadStats();
    const stats = bossStats[bossName];
    let statsLine = '';
    if (stats) {
      const hpText = stats.hp || 'Desconhecido';
      const imunesText = stats.immunities && stats.immunities.length > 0
        ? stats.immunities.join(', ')
        : 'Nenhuma';
      statsLine = `❤️ *HP:* ${hpText}\n🛡️ *Imunidades:* ${imunesText}\n\n`;
    }

    let reply = `*${bossName}*\n${statsLine}`;

    if (cities) {
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        const record = await db.getBossLastSeen(cityBossName, world);
        
        reply += `📍 *${city}*:\n`;
        const { text } = await formatBossInfo(bossName, cityBossName, record);
        reply += text + '\n';
      }
    } else {
      const record = await db.getBossLastSeen(bossName, world);
      const { text } = await formatBossInfo(bossName, bossName, record);
      reply += text;
    }

    const webpPath = path.resolve('assets', 'bosses', `${bossName}.webp`);

    if (fs.existsSync(webpPath)) {
      try {
        await sock.sendMessage(remoteJid, {
          sticker: fs.readFileSync(webpPath)
        });
      } catch (err) {
        console.error('[info] Error sending sticker:', err);
      }
    }

    await sock.sendMessage(remoteJid, {
      text: reply.trim(),
      mentions
    }, { quoted: msg });
  }
};
