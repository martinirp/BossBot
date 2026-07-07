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

// Helper to format seen_at timestamp from German time to BRT "DD/MM/YYYY HH:mm"
const formatSeenAtBrt = (seenAtStr) => {
  if (!seenAtStr) return 'Nenhum avistamento registrado ainda';
  const germanDate = db.parseDateStr(seenAtStr);
  if (!germanDate) return seenAtStr;
  const brtDate = db.utcToBrt(db.germanToUtc(germanDate));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
};

// Calculates prediction based on seenDate, minDays, and maxDays
// Returns { predictionStr, extraStr }
const calculatePrediction = (seenAtStr, minDays, maxDays, isTibiaData = false) => {
  const germanSeenDate = db.parseDateStr(seenAtStr);
  if (!germanSeenDate) return { predictionStr: 'Erro ao processar data', extraStr: '' };

  const trackingStartGerman = new Date(germanSeenDate.getTime() - 10 * 60 * 60 * 1000);
  trackingStartGerman.setUTCHours(0, 0, 0, 0);

  const shiftMinMs = isTibiaData ? -24 * 60 * 60 * 1000 : 0;
  const minDateGerman = new Date(trackingStartGerman.getTime() + minDays * 24 * 60 * 60 * 1000 + shiftMinMs);
  const maxDateGerman = new Date(trackingStartGerman.getTime() + maxDays * 24 * 60 * 60 * 1000);

  minDateGerman.setUTCHours(10, 0, 0, 0);
  maxDateGerman.setUTCHours(10, 0, 0, 0);

  const minDateBrt = db.utcToBrt(db.germanToUtc(minDateGerman));
  const maxDateBrt = db.utcToBrt(db.germanToUtc(maxDateGerman));

  const formatBrtDate = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  };

  const today = new Date();

  let predictionStr = '';
  if (minDays === maxDays) {
    predictionStr = `A cada ${minDays} dia(s)`;
  } else {
    predictionStr = `Entre ${formatBrtDate(minDateBrt)} e ${formatBrtDate(maxDateBrt)}`;
  }

  let extraStr = '';
  if (minDays !== maxDays) {
    const nowGerman = db.utcToGerman(today);
    const trackingNowGerman = new Date(nowGerman.getTime() - 10 * 60 * 60 * 1000);
    trackingNowGerman.setUTCHours(0, 0, 0, 0);

    const minCmp = new Date(minDateGerman); minCmp.setUTCHours(0, 0, 0, 0);
    const maxCmp = new Date(maxDateGerman); maxCmp.setUTCHours(0, 0, 0, 0);

    if (trackingNowGerman >= maxCmp) {
      extraStr = ' (🟢 No radar / 🟢 Alta chance)';
    } else if (trackingNowGerman >= minCmp) {
      extraStr = ' (🟢 No radar / 🟢 Com chance)';
    } else {
      extraStr = ' (🔴 Sem chance)';
    }
  }
  return { predictionStr, extraStr };
};

// Helper to format the boss details block
const formatBossInfo = async (bossName, intervalName, record) => {
  const bossIntervals = loadIntervals();
  const interval = bossIntervals[bossName] || bossIntervals[intervalName];
  let predictionText = 'Indefinida (necessita de um avistamento prévio)';

  if (interval && interval.fixedDaysFrequency) {
    const min = interval.fixedDaysFrequency.min;
    const max = interval.fixedDaysFrequency.max;

    if (record && record.seen_at) {
      const confirmedByHuman = record.confirmed_by !== 'TibiaData_API' &&
                               record.confirmed_by !== 'system_adjust' &&
                               record.confirmed_by !== 'flop';

      if (confirmedByHuman) {
        // Human confirmed: group prediction (no shift) + optional TibiaData prediction
        const groupPred = calculatePrediction(record.seen_at, min, max, false);

        let tibiaPred = null;
        if (record.tibiadata_seen_at && record.tibiadata_seen_at !== record.seen_at) {
          tibiaPred = calculatePrediction(record.tibiadata_seen_at, min, max, true);
        }

        const sameWindow = tibiaPred &&
          groupPred.predictionStr === tibiaPred.predictionStr &&
          groupPred.extraStr === tibiaPred.extraStr;

        if (sameWindow) {
          predictionText = `👥📡 Grupo & TibiaData: ${groupPred.predictionStr}${groupPred.extraStr}`;
        } else {
          predictionText = `👥 Grupo: ${groupPred.predictionStr}${groupPred.extraStr}`;
          if (tibiaPred) {
            predictionText += `\n   📡 TibiaData: ${tibiaPred.predictionStr}${tibiaPred.extraStr}`;
          }
        }
      } else {
        // Only TibiaData knows this boss — label it as such
        const tibiaPred = calculatePrediction(record.seen_at, min, max, true);
        predictionText = `📡 TibiaData: ${tibiaPred.predictionStr}${tibiaPred.extraStr}`;
      }
    }
  } else {
    predictionText = 'Sem previsão disponível';
  }

  // 1. Build map line — mostra o nome do local como link clicável
  let mapLine = '';
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
        // Busca a descrição do local correspondente
        const locObj = locations.find(l => l.link === link);
        const label = locObj ? locObj.description : city;
        mapLine = `🗺️ *Local:* [${label}](${link})\n`;
      }
    } else {
      // Múltiplos locais — cada um com nome e link
      const linkParts = locations.map(l => `[${l.description}](${l.link})`);
      mapLine = `🗺️ *Local:* ${linkParts.join(' | ')}\n`;
    }
  }

  // 2. Build prediction line
  const predictionLine = `🔮 *Previsão:* ${predictionText}\n`;

  // 3. Build seen line
  let seenLine = '';
  if (record && record.seen_at) {
    const confirmer = record.confirmed_by;
    if (confirmer === 'TibiaData_API') {
      seenLine = `👁️ *Visto:* ${formatSeenAtBrt(record.seen_at)} (por TibiaData API)\n`;
    } else {
      seenLine = `👁️ *Visto:* ${formatSeenAtBrt(record.seen_at)}\n`;
    }
  } else {
    seenLine = `👁️ *Visto:* Nenhum avistamento registrado ainda\n`;
  }

  // 4. Build recent times line
  let recentTimesLine = '';
  const recentTimes = await db.getBossRecentTimes(intervalName);
  const slicedRecentTimes = recentTimes.slice(-3);
  if (slicedRecentTimes && slicedRecentTimes.length > 0) {
    recentTimesLine = `⏰ *Últimas aparições:* ${slicedRecentTimes.join(', ')}\n`;
  }

  // 5. Combine in the requested order (map, prediction, seen, recentTimes)
  let text = '';
  text += mapLine;
  text += predictionLine;
  text += seenLine;
  text += recentTimesLine;

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
      const filteredImmunities = (stats.immunities || []).filter(
        im => im.toLowerCase() !== 'paralisia' && im.toLowerCase() !== 'invisibilidade'
      );
      const imunesText = filteredImmunities.length > 0
        ? filteredImmunities.join(', ')
        : 'Nenhuma';
      statsLine = `❤️ *HP:* ${hpText}\n🛡️ *Imunidades:* ${imunesText}\n\n`;
    }

    const bossIntervals = loadIntervals();
    const interval = bossIntervals[bossName] || bossIntervals[cities ? `${bossName} (${cities[0]})` : bossName];
    let spawnIntervalLine = '';
    if (interval && interval.fixedDaysFrequency) {
      const min = interval.fixedDaysFrequency.min;
      const max = interval.fixedDaysFrequency.max;
      if (min === max) {
        spawnIntervalLine = `📅 *Renasce a cada:* ${min} dia(s)\n`;
      } else {
        spawnIntervalLine = `📅 *Renasce de:* ${min} a ${max} dias\n`;
      }
    } else {
      spawnIntervalLine = `📅 *Renasce de:* Sem intervalo de spawn cadastrado\n`;
    }

    let reply = `*${bossName}*\n${statsLine}${spawnIntervalLine}\n`;

    if (cities) {
      const baseRecord = await db.getBossLastSeen(bossName, world);
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        let record = await db.getBossLastSeen(cityBossName, world);
        
        if (baseRecord && baseRecord.tibiadata_seen_at) {
          if (!record) {
            record = { ...baseRecord, city };
          } else if (!record.tibiadata_seen_at || baseRecord.tibiadata_seen_at > record.tibiadata_seen_at) {
            record.tibiadata_seen_at = baseRecord.tibiadata_seen_at;
            if (record.confirmed_by === 'TibiaData_API' || record.confirmed_by === 'system_adjust') {
                record.seen_at = baseRecord.seen_at;
            }
          }
        }
        
        reply += `📍 *${city}*:\n`;
        const { text } = await formatBossInfo(bossName, cityBossName, record);
        reply += text + '\n';
      }
    } else {
      const record = await db.getBossLastSeen(bossName, world);
      const { text } = await formatBossInfo(bossName, bossName, record);
      reply += text;
    }

    const bossImgPath = path.resolve('assets', 'bosses', `${bossName}.webp`);

    if (fs.existsSync(bossImgPath)) {
      try {
        await sock.sendMessage(remoteJid, { sticker: fs.readFileSync(bossImgPath) });
      } catch (err) {
        console.error('[info] Error sending image/sticker:', err);
      }
    }

    await sock.sendMessage(remoteJid, {
      text: reply.trim(),
      mentions
    }, { quoted: msg });
  }
};
