import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import { commandHandler } from './commandHandler.js';
import * as db from './database.js';

export let sockInstance = null;
export let mockSendGroupMessage = null;

export function setMockSendGroupMessage(fn) {
  mockSendGroupMessage = fn;
}

export async function sendGroupMessage(jid, text, mentions = []) {
  if (mockSendGroupMessage) {
    return mockSendGroupMessage(jid, text, mentions);
  }
  if (!sockInstance) {
    console.error('[whatsapp] Cannot send message: sockInstance is null');
    return;
  }
  try {
    await sockInstance.sendMessage(jid, { text, mentions });
    console.log(`[whatsapp] Mensagem enviada para ${jid}`);
  } catch (err) {
    console.error(`[whatsapp] Failed to send message to ${jid}:`, err);
  }
}

export async function connectToWhatsApp() {
  await commandHandler.loadCommands(); // Carrega os comandos

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const makeSocket = typeof makeWASocket === 'function' ? makeWASocket : makeWASocket.default;

  const sock = makeSocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'error' }),
    getMessage: async (key) => {
      const pollData = commandHandler.activePolls.get(key.id);
      if (pollData) return pollData.originalMessage.message;
      return undefined;
    }
  });

  sockInstance = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP TO CONNECT THE BOT ---');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      } else {
        console.log('Logged out of WhatsApp. Deleting credentials and scanning again...');
        try {
          fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        } catch (e) {
          console.error('Failed to clear credentials folder:', e);
        }
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('\n=========================================');
      console.log('WhatsApp connection opened successfully!');
      console.log('=========================================\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.pollUpdates && update.pollUpdates.length > 0) {
        await commandHandler.handlePollUpdate(sock, update);
      }
    }
  });
  
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (msg.key.fromMe) continue;
      
      // O processamento de pollUpdates agora é feito pelo messages.update
      const text = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption || 
                   '';

      if (text) {
        await commandHandler.handleMessage(sock, msg, text);
      }
    }
  });
}
