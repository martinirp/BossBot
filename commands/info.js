import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities } from '../commands.js';
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

const loadLocations = () => {
  try {
    const jsonPath = path.resolve('boss_locations.json');
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
      extraStr = " (Atrasado / Alta chance)";
    } else if (today >= minDate) {
      extraStr = " (Pode nascer)";
    } else {
      extraStr = " (Aguardando período)";
    }
  }
  return predictionStr + extraStr;
};

const getLinkForCity = (bossName, locations, city) => {
  const normCity = city.toLowerCase();
  for (const loc of locations) {
    const desc = loc.description.toLowerCase();
    
    if (normCity === 'ank' && (desc.includes('ankrahmun') || desc.includes('ank'))) return loc.link;
    if (normCity === 'poi' && (desc.includes('pits of inferno') || desc.includes('poi'))) return loc.link;
    if (normCity === 'lb' && (desc.includes('liberty bay') || desc.includes('lb'))) return loc.link;
    if (normCity === 'dara' && (desc.includes('darashia') || desc.includes('dara'))) return loc.link;
    if (normCity === 'ab' && (desc.includes("ab'dendriel") || desc.includes('ab'))) return loc.link;
    if (normCity === 'yala' && (desc.includes('yalahar') || desc.includes('yala'))) return loc.link;
    
    if (desc.includes(normCity)) {
      return loc.link;
    }
  }

  const MULTI_CITY_BOSSES = {
    "rotworm queen": ["Ab'Dendriel", "Darashia", "Edron", "Liberty Bay"],
    "the voice of ruin": ["Esquerda", "Direita"],
    "flamecaller zazrak": ["Surface", "North"],
    "tyrn": ["Liberty Bay", "Drefia"],
    "dreadmaw": ["West", "East"],
    "white pale": ["Edron", "Darashia", "Liberty Bay"],
    "hirintror": ["Mines", "Nibelor"],
    "battlemaster zunzu": ["West", "East"],
    "fleabringer": ["Surface", "North", "Sul"],
    "albino dragon": ["Farmine", "Fenrock", "Goroma", "POI", "Ank"]
  };

  const cities = MULTI_CITY_BOSSES[bossName.toLowerCase()];
  if (cities) {
    const cityIndex = cities.findIndex(c => c.toLowerCase() === normCity);
    if (cityIndex !== -1 && locations[cityIndex]) {
      return locations[cityIndex].link;
    }
  }

  if (locations.length === 1) return locations[0].link;
  return null;
};

// Helper to format the boss details block
const formatBossInfo = async (bossName, intervalName, record) => {
  const bossIntervals = loadIntervals();
  const interval = bossIntervals[intervalName];
  let avgDaysText = 'N/A';
  let predictionText = 'Indefinida (necessita de um avistamento prévio)';

  if (interval && interval.fixedDaysFrequency) {
    const min = interval.fixedDaysFrequency.min;
    const max = interval.fixedDaysFrequency.max;
    const avg = (min + max) / 2;
    
    if (min === max) {
      avgDaysText = `${min} dia(s)`;
    } else {
      avgDaysText = `${avg} dias (Faixa: ${min} a ${max} dias)`;
    }

    if (record && record.seen_at) {
      predictionText = calculatePrediction(record.seen_at, min, max, record.confirmed_by);
    }
  } else {
    avgDaysText = 'Sem intervalo de spawn cadastrado';
    predictionText = 'Sem previsão disponível';
  }

  let text = '';
  if (record && record.seen_at) {
    const confirmer = record.confirmed_by;
    let details = '';
    if (!confirmer) {
      details = 'Desconhecido';
    } else if (confirmer === 'flop') {
      details = 'Flop (Perdido)';
    } else if (confirmer === 'TibiaData_API') {
      details = 'TibiaData API';
    } else if (confirmer === 'system_adjust') {
      details = 'Sistema';
    } else if (confirmer.includes('@')) {
      const phone = confirmer.split('@')[0];
      details = `@${phone}`;
    } else {
      details = confirmer;
    }
    text += `👁️ *Último morto:* ${formatSeenAt(record.seen_at)} (por ${details})\n`;
  } else {
    text += `👁️ *Último morto:* Nenhum avistamento registrado ainda\n`;
  }

  text += `📅 *Média de spawn:* ${avgDaysText}\n`;
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

    let reply = `ℹ️ *Informações do Boss:* ${bossName}\n\n`;

    if (cities) {
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        const record = await db.getBossLastSeen(cityBossName, world);
        
        reply += `📍 *${city}*:\n`;
        const { text, confirmedBy } = await formatBossInfo(bossName, cityBossName, record);
        reply += text + '\n';
        if (confirmedBy && confirmedBy.includes('@')) mentions.push(confirmedBy);
      }
    } else {
      const record = await db.getBossLastSeen(bossName, world);
      const { text, confirmedBy } = await formatBossInfo(bossName, bossName, record);
      reply += text;
      if (confirmedBy && confirmedBy.includes('@')) mentions.push(confirmedBy);
    }

    await sock.sendMessage(remoteJid, {
      text: reply.trim(),
      mentions
    }, { quoted: msg });
  }
};
