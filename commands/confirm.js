import * as db from '../database.js';
import { findBossMatch, normalizeBossName, loadBosses, getBossCities, CITY_ALIASES, loadLocations, getLinkForCity } from '../commands.js';
import { enqueueNotification } from '../notifier.js';
import fs from 'fs';

/**
 * Verifica se a Alemanha está no horário de verão (CEST = UTC+2).
 * DST europeu: último domingo de março → último domingo de outubro.
 * @param {Date} date - data UTC de referência
 * @returns {boolean}
 */
function isGermanDST(date) {
  const year = date.getUTCFullYear();

  // Último domingo de março (DST começa às 02:00 CET = 01:00 UTC)
  const marchEnd = new Date(Date.UTC(year, 2, 31));
  while (marchEnd.getUTCDay() !== 0) marchEnd.setUTCDate(marchEnd.getUTCDate() - 1);
  const dstStart = new Date(Date.UTC(year, 2, marchEnd.getUTCDate(), 1, 0, 0));

  // Último domingo de outubro (DST termina às 03:00 CEST = 01:00 UTC)
  const octEnd = new Date(Date.UTC(year, 9, 31));
  while (octEnd.getUTCDay() !== 0) octEnd.setUTCDate(octEnd.getUTCDate() - 1);
  const dstEnd = new Date(Date.UTC(year, 9, octEnd.getUTCDate(), 1, 0, 0));

  return date >= dstStart && date < dstEnd;
}

/**
 * Retorna o horário de atualização do TibiaData em BRT (hora, minuto).
 * - Horário de verão alemão (CEST): ~22:15 BRT
 * - Horário padrão alemão (CET):   ~23:15 BRT
 * @param {Date} utcNow
 * @returns {{ hour: number, minute: number }}
 */
function getApiUpdateTimeBRT(utcNow) {
  return isGermanDST(utcNow) ? { hour: 22, minute: 15 } : { hour: 23, minute: 15 };
}

/**
 * Calcula o "dia de rastreamento" do kill para uso na previsão.
 *
 * Regra: O Tibia cutoff oficial para as estatísticas diárias é às 04:00 CET/CEST.
 * Kills antes das 04:00 CET/CEST pertencem ao dia anterior.
 * Kills após as 04:00 CET/CEST pertencem ao dia atual.
 *
 * @param {Date} utcNow - data/hora UTC atual
 * @param {string} world - O mundo do Tibia (ex: Antica)
 * @returns {{ seenAt: string, trackingDateStr: string, apiUpdatedTonight: boolean, brtTimeStr: string }}
 */
export async function calcTrackingDay(utcNow, world) {
  // Converte para BRT (UTC-3)
  const brtNow = new Date(utcNow);
  brtNow.setUTCHours(brtNow.getUTCHours() - 3);

  const brtHour = brtNow.getUTCHours();
  const brtMin  = brtNow.getUTCMinutes();
  const brtTimeStr = `${String(brtHour).padStart(2, '0')}:${String(brtMin).padStart(2, '0')}`;
  
  const pad = (n) => String(n).padStart(2, '0');

  // Determina se a Alemanha está em DST (Horário de Verão: UTC+2) ou Padrão (CET: UTC+1)
  const isDST = isGermanDST(utcNow);
  const offsetHours = isDST ? 2 : 1;

  // Calcula a hora em que o kill aconteceu na Alemanha (CET/CEST)
  const germanTime = new Date(utcNow.getTime() + offsetHours * 60 * 60 * 1000);

  // Subtrai 10 horas para alinhar com o cutoff diário de Server Save (10:00 CEST/CET) da CipSoft
  const trackingTime = new Date(germanTime.getTime() - 10 * 60 * 60 * 1000);

  // Formata o dia de rastreamento final (dia do ciclo da CipSoft)
  const trackingYear = trackingTime.getUTCFullYear();
  const trackingMonth = pad(trackingTime.getUTCMonth() + 1);
  const trackingDay = pad(trackingTime.getUTCDate());
  const trackingDateStr = `${trackingYear}-${trackingMonth}-${trackingDay}`;

  const seenAt = `${trackingDateStr} ${brtTimeStr}`;

  // Se o dia de rastreamento difere do dia civil em BRT, consideramos que o ciclo "virou" hoje.
  const todayStr = `${brtNow.getUTCFullYear()}-${pad(brtNow.getUTCMonth() + 1)}-${pad(brtNow.getUTCDate())}`;
  const apiUpdatedTonight = (trackingDateStr !== todayStr);

  return { seenAt, trackingDateStr, apiUpdatedTonight, brtTimeStr };
}

export default {
  name: 'confirm',
  aliases: ['c', 'confirmar', 'boss'],
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
          text: `⚠️ Boss *${bossRaw}* não foi encontrado. Verifique a grafia ou utilize o comando *${context.prefix}bosses* para ver a lista de bosses.`
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
        await sock.sendMessage(remoteJid, {
          text: `⚠️ O boss *${matchedBossName}* nasce em várias cidades. Por favor, especifique a cidade como argumento.\nExemplo: \`${context.prefix}boss ${matchedBossName}, Ankrahmun\`\nCidades válidas: ${validCities.join(', ')}`
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

    const subscribers = await db.getSubscribers(matchedBossName);
    const world = await db.getGroupWorld(remoteJid);

    // ── 1. Calcular dia de rastreamento ANTES de salvar ────────────────────
    const utcNow = new Date();
    const { seenAt, trackingDateStr, apiUpdatedTonight, brtTimeStr } = await calcTrackingDay(utcNow, world);

    // Formata a data de rastreamento para exibição (DD/MM/YYYY)
    const [tYear, tMonth, tDay] = trackingDateStr.split('-');
    const trackingDateDisplay = `${tDay}/${tMonth}/${tYear}`;

    // ── 2. Alertar imediatamente ──────────────────────────────────────────
    await db.addBossReport(cityBossName, extraText, senderJid, subscribers.length, world);
    await db.incrementRank(senderJid);

    // Nota informativa se a API já atualizou esta noite
    const brtNow = new Date(utcNow);
    brtNow.setUTCHours(brtNow.getUTCHours() - 3);
    const todayStr = `${String(brtNow.getUTCDate()).padStart(2, '0')}/${String(brtNow.getUTCMonth() + 1).padStart(2, '0')}`;
    const apiNote = apiUpdatedTonight
      ? `\n⚠️ Morto dia ${todayStr}, mas salvo dia ${trackingDateDisplay} para manter coerência com a API.`
      : '';

    let bossHeader = `⚔️ *${matchedBossName.toUpperCase()}*`;
    if (matchedCity) {
      bossHeader = `⚔️ *${matchedBossName.toUpperCase()}* (${matchedCity})`;
    }

    const bossLocations = loadLocations();
    const locations = bossLocations[matchedBossName] || [];
    let mapLine = '';
    if (locations.length > 0) {
      if (matchedCity) {
        const link = getLinkForCity(matchedBossName, locations, matchedCity);
        if (link) {
          mapLine = `\n🗺️ *Mapa:* ${link}`;
        }
      } else {
        const links = locations.map(l => l.link);
        mapLine = `\n🗺️ *Mapa:* ${links.join(', ')}`;
      }
    }

    const baseText = `📢 BOSS CONFIRMADO!\n${bossHeader}\n👤 Por: @${senderPhone}\n🕒 Horário: ${brtTimeStr}${apiNote}${mapLine}`;

    if (subscribers.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `${baseText}\n📭 Não há membros inscritos para notificação no momento.`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `${baseText}\n🔔 Disparando notificações\n📋 ${subscribers.length} inscrito(s)`,
        mentions: [senderJid]
      }, { quoted: msg });

      enqueueNotification(sock, subscribers, cityBossName, finalExtraText, world);
    }

    // Envia a figurinha de alerta se existir
    const stickerPath = './assets/alerta.webp';
    if (fs.existsSync(stickerPath)) {
      try {
        await sock.sendMessage(remoteJid, { sticker: { url: stickerPath } });
      } catch (err) {
        console.error('Erro ao enviar figurinha de alerta de boss:', err);
      }
    }

    // ── 3. Salvar com o dia de rastreamento correto ───────────────────────
    await db.setBossLastSeenDate(cityBossName, senderJid, seenAt, world, matchedCity);
  }
}
