import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities } from '../commands.js';
import { bossIntervals } from '../bossIntervals.js';

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
const calculatePrediction = (seenAtStr, minDays, maxDays) => {
  const datePart = seenAtStr.split(' ')[0]; // "YYYY-MM-DD"
  const seenDate = new Date(datePart + 'T03:00:00Z');

  const minDate = new Date(seenDate.getTime() + minDays * 24 * 60 * 60 * 1000);
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

// Helper to format the boss details block
const formatBossInfo = (bossName, intervalName, record) => {
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
      predictionText = calculatePrediction(record.seen_at, min, max);
    }
  } else {
    avgDaysText = 'Sem intervalo de spawn cadastrado';
    predictionText = 'Sem previsão disponível';
  }

  let text = '';
  if (record && record.seen_at) {
    const phone = record.confirmed_by.split('@')[0];
    text += `👁️ *Último morto:* ${formatSeenAt(record.seen_at)} (por @${phone})\n`;
  } else {
    text += `👁️ *Último morto:* Nenhum avistamento registrado ainda\n`;
  }

  text += `📅 *Média de spawn:* ${avgDaysText}\n`;
  text += `🔮 *Previsão:* ${predictionText}\n`;
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
        const { text, confirmedBy } = formatBossInfo(bossName, cityBossName, record);
        reply += text + '\n';
        if (confirmedBy) mentions.push(confirmedBy);
      }
    } else {
      const record = await db.getBossLastSeen(bossName, world);
      const { text, confirmedBy } = formatBossInfo(bossName, bossName, record);
      reply += text;
      if (confirmedBy) mentions.push(confirmedBy);
    }

    await sock.sendMessage(remoteJid, {
      text: reply.trim(),
      mentions
    }, { quoted: msg });
  }
};
