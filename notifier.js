import dotenv from 'dotenv';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import * as db from './database.js';
import fs from 'fs';
dotenv.config();

const SPAM_COUNT = parseInt(process.env.SPAM_COUNT || '4', 10);
const SPAM_INTERVAL_MS = parseInt(process.env.SPAM_INTERVAL_MS || '1500', 10);
const SUBSCRIBER_INTERVAL_MS = parseInt(process.env.SUBSCRIBER_INTERVAL_MS || '2000', 10);
const PUSHOVER_RETRY = parseInt(process.env.PUSHOVER_RETRY || '30', 10);
const PUSHOVER_SOUND = process.env.PUSHOVER_SOUND || 'siren';
// Queue of jobs to process sequentially
const jobQueue = [];
let isProcessing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a notification via Pushover API.
 * @param {string} token - The Pushover application API token
 * @param {string} user - The Pushover user/group key
 * @param {string} message - The message body
 * @param {string} title - The title of the alert
 */
export async function sendPushoverMessage(token, user, message, title = 'BossBot Alert', priority = 2) {
  if (!token || !user) return;
  try {
    const bodyObj = {
      token,
      user,
      message,
      title,
      priority: 2, // Forçando Nível 2 (Emergência) para todos os alertas
      sound: PUSHOVER_SOUND,
      retry: PUSHOVER_RETRY,
      expire: 3600 // 1 hora de repetição
    };

    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    const data = await response.json();

    if (!response.ok || data.status !== 1) {
      const errorMsg = data.errors ? data.errors.join(', ') : JSON.stringify(data);
      throw new Error(`Pushover API Error: ${response.status} - ${errorMsg}`);
    }

    console.log(`[PUSHOVER] Notificação enviada com sucesso para ${user}`);
    return data;
  } catch (err) {
    console.error(`[PUSHOVER] Falha na requisição HTTP para ${user}:`, err);
  }
}

export async function enqueueNotification(sock, subscribers, bossName, extraText, world = 'Quelibra') {
  try {
    const uppercaseBoss = bossName.toUpperCase();
    const now = new Date();
    now.setHours(now.getHours() - 3);
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const alertMessage = extraText 
      ? `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${uppercaseBoss}\n🕒 *Horário:* ${timeString}\n📍 *Detalhes:* ${extraText}`
      : `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${uppercaseBoss}\n🕒 *Horário:* ${timeString}`;

    console.log(`Starting validation for boss ${uppercaseBoss} on world ${world} with ${subscribers.length} subscribers.`);

    const allowedGroups = await db.getAllowedGroups();
    const activeMembersSet = new Set();
    const groupMentionsMap = new Map(); // groupJid -> array of normalized JIDs
    
    for (const groupJid of allowedGroups) {
      const groupWorld = await db.getGroupWorld(groupJid);
      if (groupWorld === world) {
        try {
          const metadata = await sock.groupMetadata(groupJid);
          const groupSubs = [];
          for (const p of metadata.participants) {
            const clean = jidNormalizedUser(p.id);
            activeMembersSet.add(clean);
            if (subscribers.some(s => jidNormalizedUser(s) === clean)) {
              groupSubs.push(clean);
            }
          }
          if (groupSubs.length > 0) {
            groupMentionsMap.set(groupJid, groupSubs);
          }
        } catch (err) {
          console.error(`Erro ao buscar metadados do grupo ${groupJid} no mundo ${world}:`, err);
        }
      }
    }

    const allowedCommunities = await db.getAllowedCommunities();
    const targetCommunities = [];
    for (const commJid of allowedCommunities) {
      const commWorld = await db.getCommunityWorld(commJid);
      if (commWorld === world) {
        targetCommunities.push(commJid);
      }
    }

    const validSubscribers = subscribers.filter(sub => activeMembersSet.has(jidNormalizedUser(sub)));
    console.log(`Filtered down to ${validSubscribers.length} valid subscribers.`);

    // 1. Process Pushover notifications in parallel immediately
    const globalToken = process.env.PUSHOVER_TOKEN;
    const globalUser = process.env.PUSHOVER_USER_KEY;

    if (globalToken) {
      if (globalUser) {
        const globalLevelStr = await db.getGlobalSetting('global_alert_level');
        const globalLevel = globalLevelStr !== null ? parseInt(globalLevelStr, 10) : 1;
        
        console.log(`[PUSHOVER] Enviando notificação global para o boss ${uppercaseBoss} (Priority: ${globalLevel})`);
        sendPushoverMessage(globalToken, globalUser, alertMessage, `BossBot: ${uppercaseBoss}`, globalLevel).catch(err => {
          console.error('[PUSHOVER] Erro ao enviar notificação global:', err);
        });
      }

      if (validSubscribers.length > 0) {
        db.getPushoverKeysForSubscribers(validSubscribers).then(mapping => {
          const promises = [];
          for (const subscriber of validSubscribers) {
            const cleanJid = jidNormalizedUser(subscriber);
            const userPref = mapping[cleanJid];
            if (userPref && userPref.key) {
              console.log(`[PUSHOVER] Enviando notificação pessoal para ${cleanJid} (Priority: ${userPref.alert_level})`);
              promises.push(sendPushoverMessage(globalToken, userPref.key, alertMessage, `BossBot: ${uppercaseBoss}`, userPref.alert_level));
            }
          }
          return Promise.all(promises);
        }).catch(err => {
          console.error('[PUSHOVER] Erro ao enviar notificações Pushover para assinantes:', err);
        });
      }
    }

    // 2. Enqueue WhatsApp notifications to be processed sequentially
    if (validSubscribers.length > 0 || targetCommunities.length > 0) {
      jobQueue.push({ sock, validSubscribers, bossName, alertMessage, groupMentionsMap, targetCommunities });
      processQueue();
    }
  } catch (err) {
    console.error('Error in enqueueNotification:', err);
  }
}

async function processQueue() {
  if (isProcessing) return;
  if (jobQueue.length === 0) return;

  isProcessing = true;
  const { sock, validSubscribers, bossName, alertMessage, groupMentionsMap, targetCommunities } = jobQueue.shift();

  try {
    const uppercaseBoss = bossName.toUpperCase();
    console.log(`Starting WhatsApp notifications for boss ${uppercaseBoss}.`);

    // Sticker específico do boss — sem fallback genérico
    const bossImgPath = `./assets/bosses/${bossName}.webp`;
    let stickerMsg = null;
    if (fs.existsSync(bossImgPath)) {
      stickerMsg = { sticker: { url: bossImgPath } };
    } else {
      console.log(`[STICKER] Imagem específica não encontrada para ${bossName}, sticker não será enviado.`);
    }

    // 1. Group Mentions
    // Sequência: sticker → alertMessage → menções (numa só mensagem logo abaixo)
    if (process.env.ENABLE_GROUP_MENTIONS === 'true' && groupMentionsMap && groupMentionsMap.size > 0) {
      for (const [groupJid, mentions] of groupMentionsMap.entries()) {
        try {
          // 1a. Sticker do boss primeiro
          if (stickerMsg) {
            await sock.sendMessage(groupJid, stickerMsg);
          }
          // 1b. Mensagem padrão do grupo + Menções em um único balão
          let finalGroupText = alertMessage;
          if (mentions.length > 0) {
            const mentionsText = mentions.map(jid => `@${jid.split('@')[0]}`).join(' ');
            finalGroupText += `\n\n${mentionsText}`;
          }
          await sock.sendMessage(groupJid, { text: finalGroupText, mentions });
          console.log(`[GROUP_MENTION] Sent to ${groupJid} with ${mentions.length} tags`);
          await sleep(1000);
        } catch (err) {
          console.error(`[GROUP_MENTION] Failed to send to ${groupJid}:`, err);
        }
      }
    }

    // 2. Community Alerts
    // Sequência: sticker → mesma mensagem do DM privado (sem marcar ninguém)
    if (process.env.ENABLE_COMMUNITY_ALERTS === 'true' && targetCommunities && targetCommunities.length > 0) {
      for (const commJid of targetCommunities) {
        try {
          // 2a. Sticker do boss primeiro
          if (stickerMsg) {
            await sock.sendMessage(commJid, stickerMsg);
          }
          // 2b. Mesma mensagem do DM — sem menções
          await sock.sendMessage(commJid, { text: alertMessage });
          console.log(`[COMMUNITY_ALERT] Sent to ${commJid}`);
          await sleep(1000);
        } catch (err) {
          console.error(`[COMMUNITY_ALERT] Failed to send to ${commJid}:`, err);
        }
      }
    }

    // 3. Individual DMs (Spam)
    if (SPAM_COUNT > 0 && validSubscribers && validSubscribers.length > 0) {
      for (let i = 0; i < validSubscribers.length; i++) {
        const jid = jidNormalizedUser(validSubscribers[i]);
      console.log(`Notifying ${jid} (${i + 1}/${validSubscribers.length})`);

      for (let j = 0; j < SPAM_COUNT; j++) {
        try {
          await sock.sendMessage(jid, { text: alertMessage });
          console.log(`  Spam ${j + 1}/${SPAM_COUNT} sent to ${jid}`);
        } catch (err) {
          console.error(`  Failed to send spam ${j + 1} to ${jid}:`, err);
        }
        
        // Wait between spam messages (except after the last one)
        if (j < SPAM_COUNT - 1) {
          await sleep(SPAM_INTERVAL_MS);
        }
      }

      // Wait between subscribers (except after the last subscriber)
      if (i < validSubscribers.length - 1) {
        await sleep(SUBSCRIBER_INTERVAL_MS);
      }
    }
    } // close if (SPAM_COUNT > 0)
    console.log(`Finished notifications for boss ${uppercaseBoss}`);
  } catch (err) {
    console.error('Error during notification processing:', err);
  } finally {
    isProcessing = false;
    // Process next item in queue
    processQueue();
  }
}
