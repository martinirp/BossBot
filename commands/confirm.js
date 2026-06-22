import * as db from '../database.js';
import { findBossMatch, normalizeBossName, loadBosses } from '../commands.js';
import { enqueueNotification } from '../notifier.js';

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
 * @returns {{ seenAt: string, trackingDateStr: string, apiUpdatedTonight: boolean, brtTimeStr: string }}
 */
function calcTrackingDay(utcNow) {
  // Converte para BRT (UTC-3)
  const brtNow = new Date(utcNow);
  brtNow.setUTCHours(brtNow.getUTCHours() - 3);

  const brtHour = brtNow.getUTCHours();
  const brtMin  = brtNow.getUTCMinutes();
  const brtTimeStr = `${String(brtHour).padStart(2, '0')}:${String(brtMin).padStart(2, '0')}`;

  // Horário de atualização da API em BRT (depende do horário de verão alemão)
  const apiTime = getApiUpdateTimeBRT(utcNow);
  const apiUpdatedTonight = (brtHour > apiTime.hour) ||
                            (brtHour === apiTime.hour && brtMin >= apiTime.minute);

  // Dia de rastreamento: D (antes da atualização) ou D+1 (depois da atualização)
  const trackingDate = new Date(brtNow);
  if (apiUpdatedTonight) {
    trackingDate.setUTCDate(trackingDate.getUTCDate() + 1);
  }

  const pad = (n) => String(n).padStart(2, '0');
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
    const subscribers = await db.getSubscribers(matchedBossName);
    const world = await db.getGroupWorld(remoteJid);

    // ── 1. Calcular dia de rastreamento ANTES de salvar ────────────────────
    const utcNow = new Date();
    const { seenAt, trackingDateStr, apiUpdatedTonight, brtTimeStr } = calcTrackingDay(utcNow);

    // Formata a data de rastreamento para exibição (DD/MM/YYYY)
    const [tYear, tMonth, tDay] = trackingDateStr.split('-');
    const trackingDateDisplay = `${tDay}/${tMonth}/${tYear}`;

    // ── 2. Alertar imediatamente ──────────────────────────────────────────
    await db.addBossReport(matchedBossName, extraText, senderJid, subscribers.length);
    await db.incrementRank(senderJid);

    // Nota informativa se a API já atualizou esta noite
    const apiNote = apiUpdatedTonight
      ? `\nAPI atualizada: kill registrado no proximo ciclo (${trackingDateDisplay})`
      : '';

    if (subscribers.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `📢 BOSS CONFIRMADO!\n⚔️ *${matchedBossName.toUpperCase()}*\n👤 Por: @${senderPhone}\n🕒 Horário: ${brtTimeStr}${apiNote}\n📭 Não há membros inscritos para notificação no momento.`,
        mentions: [senderJid]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(remoteJid, {
        text: `📢 BOSS CONFIRMADO!\n⚔️ *${matchedBossName.toUpperCase()}*\n👤 Por: @${senderPhone}\n🕒 Horário: ${brtTimeStr}${apiNote}\n🔔 Disparando notificações\n📋 ${subscribers.length} inscrito(s)`,
        mentions: [senderJid]
      }, { quoted: msg });

      enqueueNotification(sock, subscribers, matchedBossName, extraText, world);
    }

    // ── 3. Salvar com o dia de rastreamento correto ───────────────────────
    await db.setBossLastSeenDate(matchedBossName, senderJid, seenAt, world);
  }
}
