import dotenv from 'dotenv';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
dotenv.config();

const SPAM_COUNT = parseInt(process.env.SPAM_COUNT || '4', 10);
const SPAM_INTERVAL_MS = parseInt(process.env.SPAM_INTERVAL_MS || '1500', 10);
const SUBSCRIBER_INTERVAL_MS = parseInt(process.env.SUBSCRIBER_INTERVAL_MS || '2000', 10);
// Queue of jobs to process sequentially
const jobQueue = [];
let isProcessing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const alertMessage = extraText 
      ? `🚨🚨 ALERTA DE BOSS: ${uppercaseBoss} 🚨🚨\nLocal/Detalhes: ${extraText}`
      : `🚨🚨 ALERTA DE BOSS: ${uppercaseBoss} 🚨🚨`;

    console.log(`Starting notifications for boss ${uppercaseBoss} to ${subscribers.length} subscribers.`);

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
