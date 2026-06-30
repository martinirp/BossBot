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
 * Regra: o TibiaData atualiza Kill Statistics uma vez por dia (~22:15 ou ~23:15 BRT).
 * Tudo morto ANTES dessa atualização aparece no ciclo atual (dia D).
 * Tudo morto DEPOIS aparece no ciclo seguinte (dia D+1).
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
  const todayStr = `${brtNow.getUTCFullYear()}-${pad(brtNow.getUTCMonth() + 1)}-${pad(brtNow.getUTCDate())}`;

  let apiUpdatedTonight = false;

  // Só tentamos checar a API dinamicamente se estivermos na janela onde a CipSoft costuma atualizar (21:00 às 23:59)
  if (brtHour >= 21) {
    const flippedDate = await db.getGlobalSetting(`tibiadata_flipped_date_${world}`);
    
    if (flippedDate === todayStr) {
      // Já sabemos que atualizou hoje
      apiUpdatedTonight = true;
    } else {
      try {
        const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${world}`);
        if (res.ok) {
          const data = await res.json();
          const entries = data.killstatistics?.entries || [];
          let currentSum = 0;
          entries.forEach(e => { currentSum += e.last_day_killed; });
          
          const savedSumStr = await db.getGlobalSetting(`tibiadata_checksum_${world}`);
          const savedSum = parseInt(savedSumStr, 10);
          
          if (savedSum && currentSum !== savedSum) {
            // A soma mudou! A API virou.
            apiUpdatedTonight = true;
            await db.setGlobalSetting(`tibiadata_flipped_date_${world}`, todayStr);
            await db.setGlobalSetting(`tibiadata_checksum_${world}`, currentSum); // Atualiza pra não acusar falsa mudança
          }
        }
      } catch (err) {
        console.error('[confirm.js] Falha ao checar checksum da API:', err);
      }
    }
  }

  // Fallback caso a API falhe ou a soma não exista (primeiro dia)
  if (!apiUpdatedTonight && brtHour >= 21) {
    const apiTime = getApiUpdateTimeBRT(utcNow);
    apiUpdatedTonight = (brtHour > apiTime.hour) || (brtHour === apiTime.hour && brtMin >= apiTime.minute);
  }

  // Regra:
  // Kills ANTES da atualizacao (~22:15 ou ~23:15 BRT) pertencem ao ciclo atual → dia D.
  // Kills APOS a atualizacao pertencem ao ciclo seguinte → dia D+1.
  const trackingDate = new Date(brtNow);
  if (apiUpdatedTonight) {
    trackingDate.setUTCDate(trackingDate.getUTCDate() + 1);
  }

  const trackingDateStr = `${trackingDate.getUTCFullYear()}-${pad(trackingDate.getUTCMonth() + 1)}-${pad(trackingDate.getUTCDate())}`;
  const seenAt = `${trackingDateStr} ${brtTimeStr}`;

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
    await db.addBossReport(cityBossName, extraText, senderJid, subscribers.length);
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
