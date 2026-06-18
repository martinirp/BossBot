import dotenv from 'dotenv';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { getPushoverKeysForSubscribers, getGlobalSetting } from './database.js';
dotenv.config();

const SPAM_COUNT = parseInt(process.env.SPAM_COUNT || '4', 10);
const SPAM_INTERVAL_MS = parseInt(process.env.SPAM_INTERVAL_MS || '1500', 10);
const SUBSCRIBER_INTERVAL_MS = parseInt(process.env.SUBSCRIBER_INTERVAL_MS || '2000', 10);
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
export async function sendPushoverMessage(token, user, message, title = 'BossBot Alert', priority = 1) {
  if (!token || !user) return;
  try {
    const bodyObj = {
      token,
      user,
      message,
      title,
      priority,
      sound: 'siren'
    };

    if (priority === 2) {
      bodyObj.retry = 30;
      bodyObj.expire = 3600;
    }

    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`[PUSHOVER] Erro ao enviar mensagem para ${user}:`, errText);
    } else {
      console.log(`[PUSHOVER] Notificação enviada com sucesso para ${user}`);
    }
  } catch (err) {
    console.error(`[PUSHOVER] Falha na requisição HTTP para ${user}:`, err);
  }
}

/**
 * Enqueue a notification job.
 * @param {object} sock - The Baileys socket instance
 * @param {string[]} subscribers - List of JIDs to notify
 * @param {string} bossName - Name of the boss
 * @param {string} extraText - Localization/details text
 */
export function enqueueNotification(sock, subscribers, bossName, extraText) {
  jobQueue.push({ sock, subscribers, bossName, extraText });
  processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  if (jobQueue.length === 0) return;

  isProcessing = true;
  const { sock, subscribers, bossName, extraText } = jobQueue.shift();

  try {
    const uppercaseBoss = bossName.toUpperCase();
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const alertMessage = extraText 
      ? `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${uppercaseBoss}\n🕒 *Horário:* ${timeString}\n📍 *Detalhes:* ${extraText}`
      : `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${uppercaseBoss}\n🕒 *Horário:* ${timeString}`;

    console.log(`Starting notifications for boss ${uppercaseBoss} to ${subscribers.length} subscribers.`);

    // 1. Process Pushover notifications in parallel immediately
    const globalToken = process.env.PUSHOVER_TOKEN;
    const globalUser = process.env.PUSHOVER_USER_KEY;

    if (globalToken) {
      if (globalUser) {
        const globalLevelStr = await getGlobalSetting('global_alert_level');
        const globalLevel = globalLevelStr !== null ? parseInt(globalLevelStr, 10) : 1;
        
        console.log(`[PUSHOVER] Enviando notificação global para o boss ${uppercaseBoss} (Priority: ${globalLevel})`);
        sendPushoverMessage(globalToken, globalUser, alertMessage, `BossBot: ${uppercaseBoss}`, globalLevel).catch(err => {
          console.error('[PUSHOVER] Erro ao enviar notificação global:', err);
        });
      }

      if (subscribers.length > 0) {
        getPushoverKeysForSubscribers(subscribers).then(mapping => {
          const promises = [];
          for (const subscriber of subscribers) {
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

    for (let i = 0; i < subscribers.length; i++) {
      const jid = jidNormalizedUser(subscribers[i]);
      console.log(`Notifying ${jid} (${i + 1}/${subscribers.length})`);

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
      if (i < subscribers.length - 1) {
        await sleep(SUBSCRIBER_INTERVAL_MS);
      }
    }
    console.log(`Finished notifications for boss ${uppercaseBoss}`);
  } catch (err) {
    console.error('Error during notification processing:', err);
  } finally {
    isProcessing = false;
    // Process next item in queue
    processQueue();
  }
}
