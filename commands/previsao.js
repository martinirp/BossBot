import * as db from '../database.js';
import fs from 'fs';
import path from 'path';

const loadIntervals = () => {
  try {
    const jsonPath = path.resolve('boss_intervals.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error('[previsao] Error loading boss_intervals.json:', err);
    return {};
  }
};

/**
 * Builds a prediction using German-time logic.
 * Returns { predictionStr, extraStr } or null if boss is not in spawn window.
 * isTibiaData=true applies the -1 day shift on minDate.
 */
function buildPrediction(seenAtStr, minDays, maxDays, isTibiaData = false) {
  const germanSeenDate = db.parseDateStr(seenAtStr);
  if (!germanSeenDate) return null;

  // Subtract 10h to align with cycle counting (Server Save at 10:00 CEST/CET)
  const trackingStartGerman = new Date(germanSeenDate.getTime() - 10 * 60 * 60 * 1000);
  trackingStartGerman.setUTCHours(0, 0, 0, 0);

  const shiftMinMs = isTibiaData ? -24 * 60 * 60 * 1000 : 0;
  const minDateGerman = new Date(trackingStartGerman.getTime() + minDays * 24 * 60 * 60 * 1000 + shiftMinMs);
  const maxDateGerman = new Date(trackingStartGerman.getTime() + maxDays * 24 * 60 * 60 * 1000);

  // Convert to BRT for display
  minDateGerman.setUTCHours(10, 0, 0, 0);
  maxDateGerman.setUTCHours(10, 0, 0, 0);

  const minDateBrt = db.utcToBrt(db.germanToUtc(minDateGerman));
  const maxDateBrt = db.utcToBrt(db.germanToUtc(maxDateGerman));

  const formatBrtDate = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  };

  let predictionStr;
  if (minDays === maxDays) {
    predictionStr = `A cada ${minDays} dia(s)`;
  } else {
    predictionStr = `Entre ${formatBrtDate(minDateBrt)} e ${formatBrtDate(maxDateBrt)}`;
  }

  let extraStr = '';
  if (minDays !== maxDays) {
    const today = new Date();
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
      // Not in spawn window — skip this boss
      return null;
    }
  }

  return { predictionStr, extraStr };
}

// Format seen_at from German time to BRT "DD/MM/YYYY HH:mm"
const formatSeenAtBrt = (seenAtStr) => {
  const germanDate = db.parseDateStr(seenAtStr);
  if (!germanDate) return seenAtStr;
  const brtDate = db.utcToBrt(db.germanToUtc(germanDate));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(brtDate.getUTCDate())}/${pad(brtDate.getUTCMonth() + 1)}/${brtDate.getUTCFullYear()} ${pad(brtDate.getUTCHours())}:${pad(brtDate.getUTCMinutes())}`;
};

export default {
  name: 'previsao',
  aliases: ['chances', 'tracker'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid } = context;

    try {
      const bossIntervals = loadIntervals();
      const world = await db.getGroupWorld(remoteJid);
      const allSeen = await db.getAllBossesLastSeen(world);

      const bossesWithPrediction = [];

      for (const record of allSeen) {
        const bName = record.boss_name;
        if (!bossIntervals[bName]) continue;

        const stats = bossIntervals[bName];
        if (!stats.fixedDaysFrequency) continue;

        const minDays = stats.fixedDaysFrequency.min;
        const maxDays = stats.fixedDaysFrequency.max;

        // ── Previsão do Grupo ────────────────────────────────────────────
        const isTibiadataSource = record.confirmed_by === 'TibiaData_API';
        const groupResult = buildPrediction(record.seen_at, minDays, maxDays, isTibiadataSource);

        // ── Previsão TibiaData ───────────────────────────────────────────
        let tibiaResult = null;
        if (record.tibiadata_seen_at && record.tibiadata_seen_at !== record.seen_at) {
          tibiaResult = buildPrediction(record.tibiadata_seen_at, minDays, maxDays, true);
        }

        // Skip boss entirely if neither prediction is in the spawn window
        if (!groupResult && !tibiaResult) continue;

        // ── Build the combined prediction text ──────────────────────────
        const recentTimes = await db.getBossRecentTimes(bName);
        const slicedRecentTimes = recentTimes.slice(-3);

        let predictionText = '';

        const sameWindow = groupResult && tibiaResult &&
          groupResult.predictionStr === tibiaResult.predictionStr &&
          groupResult.extraStr === tibiaResult.extraStr;

        if (sameWindow) {
          predictionText = `👥📡 *Grupo & TibiaData:* ${groupResult.predictionStr}${groupResult.extraStr}`;
        } else {
          if (groupResult) {
            predictionText += `👥 *Grupo:* ${groupResult.predictionStr}${groupResult.extraStr}`;
          }
          if (tibiaResult) {
            if (predictionText) predictionText += '\n';
            predictionText += `📡 *TibiaData:* ${tibiaResult.predictionStr}${tibiaResult.extraStr}`;
          }
        }

        if (slicedRecentTimes && slicedRecentTimes.length > 0) {
          predictionText += `\n⏰ *Últimas aparições:* ${slicedRecentTimes.join(', ')}`;
        }

        bossesWithPrediction.push({
          name: bName,
          lastSeenFormatted: formatSeenAtBrt(record.seen_at),
          prediction: predictionText
        });
      }

      if (bossesWithPrediction.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `Nenhuma previsão disponível no momento.`
        }, { quoted: msg });
        return;
      }

      bossesWithPrediction.sort((a, b) => a.name.localeCompare(b.name));

      let textMsg = `*Previsão de Bosses*\n\n`;
      for (const b of bossesWithPrediction) {
        textMsg += `*${b.name}*\n`;
        textMsg += `Último avistamento: ${b.lastSeenFormatted}\n`;
        textMsg += `${b.prediction}\n\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: textMsg.trim()
      }, { quoted: msg });

    } catch (err) {
      console.error('[previsao] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao calcular as previsões.`
      }, { quoted: msg });
    }
  }
}
