import makeWASocket, { useMultiFileAuthState, DisconnectReason, getAggregateVotesInPollMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import { decryptPollVote } from '@whiskeysockets/baileys/lib/Utils/process-message.js';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { parseMessage, normalizeBossName, findBossMatch } from './commands.js';
import * as db from './database.js';
import { enqueueNotification } from './notifier.js';



function loadBosses() {
  const filePath = path.resolve('bosses.json');
  if (!fs.existsSync(filePath)) {
    const defaultBosses = [
      "Ferumbras",
      "Ghazbaran",
      "Morgaroth",
      "Orshabaal",
      "Zushuka",
      "Chayenne",
      "Shlorg",
      "Munster",
      "Onyx",
      "Grand Mother Reapers"
    ];
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultBosses, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to create default bosses.json:', e);
    }
    return defaultBosses;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Error loading bosses.json, using defaults:', err);
    return ["Ferumbras", "Ghazbaran", "Morgaroth", "Orshabaal", "Zushuka", "Munster"];
  }
}

dotenv.config();

const ALLOWED_GROUP_JID = process.env.ALLOWED_GROUP_JID;

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // To prevent ESM import issues in some Node environments, we verify if makeWASocket is a function
  // or if we should use makeWASocket.default
  const makeSocket = typeof makeWASocket === 'function' ? makeWASocket : makeWASocket.default;

  const sock = makeSocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'error' }),
    getMessage: async (key) => {
      console.log(`[POLL] getMessage chamado para ID: ${key.id}`);
      try {
        const msg = await db.getPollMessage(key.id);
        console.log(`[POLL] getMessage retornou da DB para ID ${key.id}:`, msg ? 'ENCONTRADO' : 'NÃO ENCONTRADO');
        return msg?.message || undefined;
      } catch (err) {
        console.error('[POLL] Erro no getMessage do Baileys:', err);
        return undefined;
      }
    }
  });

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
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');

      const text = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption || 
                   '';

      const parsed = parseMessage(text);
      if (!parsed) continue;

      const senderJid = jidNormalizedUser(msg.key.participant || remoteJid);
      const senderPhone = senderJid.split('@')[0];

      // Validação de Grupo ou DM
      const allowedGroups = await db.getAllowedGroups();
      let isAllowed = false;

      if (isGroup) {
        if (allowedGroups.includes(remoteJid)) {
          isAllowed = true;
        } else {
          // Em grupos não cadastrados, só permite o !addgroup
          if (parsed.type === 'addgroup') {
            isAllowed = true;
          }
        }
      } else {
        // Se for DM, proíbe o comando de confirmar
        if (parsed.type === 'confirm') {
          await sock.sendMessage(remoteJid, {
            text: `⚠️ O comando de confirmar o boss só pode ser usado no grupo oficial para alertar a todos!`
          }, { quoted: msg });
          continue;
        }

        if (allowedGroups.length > 0) {
          try {
            for (const groupJid of allowedGroups) {
              const metadata = await sock.groupMetadata(groupJid);
              const isMember = metadata.participants.some(p => p.id === senderJid);
              if (isMember) {
                isAllowed = true;
                break;
              }
            }
          } catch (err) {
            console.error('Erro ao buscar metadados de grupos para validar DM:', err);
          }

          if (!isAllowed) {
            await sock.sendMessage(remoteJid, {
              text: `🚫 Acesso Negado! O BossBot é exclusivo para membros dos grupos oficiais.`
            }, { quoted: msg });
          }
        }
      }

      if (!isAllowed) continue;

      try {
        if (parsed.type === 'addgroup') {
          if (!isGroup) {
            await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo.` }, { quoted: msg });
            continue;
          }
          const maxGroups = parseInt(process.env.MAX_ALLOWED_GROUPS || '1', 10);
          if (allowedGroups.length >= maxGroups && !allowedGroups.includes(remoteJid)) {
            await sock.sendMessage(remoteJid, { text: `⚠️ Não é possível vincular este grupo no momento.` }, { quoted: msg });
            continue;
          }
          const success = await db.addGroup(remoteJid);
          if (success || allowedGroups.includes(remoteJid)) {
            await sock.sendMessage(remoteJid, { text: `✅ Bot vinculado a este grupo com sucesso!` }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, { text: `⚠️ Falha ao vincular o grupo.` }, { quoted: msg });
          }
          continue;
        }

        if (parsed.type === 'removegroup') {
          if (!isGroup) {
            await sock.sendMessage(remoteJid, { text: `⚠️ Este comando só funciona dentro de um grupo.` }, { quoted: msg });
            continue;
          }
          const success = await db.removeGroup(remoteJid);
          if (success) {
            await sock.sendMessage(remoteJid, { text: `❌ Bot desvinculado deste grupo com sucesso.` }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, { text: `⚠️ Este grupo já não estava vinculado.` }, { quoted: msg });
          }
          continue;
        }

        if (parsed.type === 'group_id') {
          if (isGroup) {
            await sock.sendMessage(remoteJid, {
              text: `ℹ️ O ID deste grupo é:\n*${remoteJid}*`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `⚠️ Este comando só funciona se for enviado dentro de um grupo.`
            }, { quoted: msg });
          }
          continue;
        }

        let matchedBossName = null;
        let isCorrected = false;

        if (parsed.type === 'confirm') {
          const bossesList = loadBosses();
          const matchResult = findBossMatch(parsed.bossName, bossesList);

          if (matchResult.match) {
            matchedBossName = matchResult.match;
            isCorrected = normalizeBossName(parsed.bossName) !== normalizeBossName(matchedBossName);
          } else {
            if (matchResult.suggestions.length > 0) {
              const suggestionsStr = matchResult.suggestions.map(s => `*${s}*`).join(', ');
              await sock.sendMessage(remoteJid, {
                text: `⚠️ Boss *${parsed.bossName}* não foi encontrado. Você quis dizer: ${suggestionsStr}?`
              }, { quoted: msg });
            } else {
              await sock.sendMessage(remoteJid, {
                text: `⚠️ Boss *${parsed.bossName}* não foi encontrado. Verifique a grafia ou utilize o comando *!bosses* para ver a lista de bosses.`
              }, { quoted: msg });
            }
            continue;
          }
        }

        if (parsed.type === 'subscribe_multiple') {
          const bossesList = loadBosses();
          const successList = [];
          const alreadyList = [];
          const notFoundList = [];

          for (const bossInput of parsed.bosses) {
            const matchResult = findBossMatch(bossInput, bossesList);
            if (matchResult.match) {
              const success = await db.addSubscription(senderJid, matchResult.match);
              if (success) successList.push(matchResult.match);
              else alreadyList.push(matchResult.match);
            } else {
              notFoundList.push(bossInput);
            }
          }

          let responseText = ``;
          if (successList.length > 0) responseText += `✅ Inscrito: ${successList.map(b => `*${b}*`).join(', ')}\n`;
          if (alreadyList.length > 0) responseText += `ℹ️ Já inscrito: ${alreadyList.map(b => `*${b}*`).join(', ')}\n`;
          if (notFoundList.length > 0) responseText += `❌ Não encontrado: ${notFoundList.map(b => `*${b}*`).join(', ')}\n`;
          
          await sock.sendMessage(remoteJid, {
            text: `@${senderPhone}\n${responseText.trim()}`,
            mentions: [senderJid]
          }, { quoted: msg });
        } 
        
        else if (parsed.type === 'remove_multiple') {
          const bossesList = loadBosses();
          const successList = [];
          const notSubbedList = [];
          const notFoundList = [];

          for (const bossInput of parsed.bosses) {
            const matchResult = findBossMatch(bossInput, bossesList);
            if (matchResult.match) {
              const success = await db.removeSubscription(senderJid, matchResult.match);
              if (success) successList.push(matchResult.match);
              else notSubbedList.push(matchResult.match);
            } else {
              notFoundList.push(bossInput);
            }
          }

          let responseText = ``;
          if (successList.length > 0) responseText += `❌ Removido: ${successList.map(b => `*${b}*`).join(', ')}\n`;
          if (notSubbedList.length > 0) responseText += `⚠️ Não estava inscrito: ${notSubbedList.map(b => `*${b}*`).join(', ')}\n`;
          if (notFoundList.length > 0) responseText += `❌ Não encontrado: ${notFoundList.map(b => `*${b}*`).join(', ')}\n`;
          
          await sock.sendMessage(remoteJid, {
            text: `@${senderPhone}\n${responseText.trim()}`,
            mentions: [senderJid]
          }, { quoted: msg });
        }
        
        else if (parsed.type === 'list') {
          const list = await db.getBossSubscriptionsForJid(senderJid);
          if (list.length > 0) {
            const listStr = list.map(b => `- *${b}*`).join('\n');
            await sock.sendMessage(remoteJid, {
              text: `📋 @${senderPhone}, você está inscrito nos seguintes bosses:\n${listStr}`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `📋 @${senderPhone}, você não está inscrito em nenhum boss.`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        } 
        
        else if (parsed.type === 'clear') {
          const removedCount = await db.clearSubscriptionsForJid(senderJid);
          if (removedCount > 0) {
            await sock.sendMessage(remoteJid, {
              text: `🧹 @${senderPhone}, suas inscrições foram limpas! Você foi desinscrito de ${removedCount} boss(es).`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `🧹 @${senderPhone}, você não possui nenhuma inscrição de boss para limpar.`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        }
        
        else if (parsed.type === 'clear_help') {
          await sock.sendMessage(remoteJid, {
            text: `⚠️ @${senderPhone}, para limpar as inscrições de um boss específico, use:\n*!limpar <nome do boss>* (Ex: \`!limpar ferumbras\`)\n\nPara limpar TODAS as suas inscrições de bosses de uma vez, use:\n*!limparbosses*`,
            mentions: [senderJid]
          }, { quoted: msg });
        }

        else if (parsed.type === 'pushover_set') {
          const success = await db.setUserPushoverKey(senderJid, parsed.key);
          if (success) {
            await sock.sendMessage(remoteJid, {
              text: `✅ @${senderPhone}, seu Pushover User Key foi cadastrado com sucesso!`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `⚠️ @${senderPhone}, ocorreu um erro ao salvar seu Pushover User Key.`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        }

        else if (parsed.type === 'alert_set') {
          const success = await db.setGlobalSetting('global_alert_level', parsed.level);
          if (success) {
            let desc = '';
            if (parsed.level === 0) desc = 'Normal (Toca 1 vez, respeita silencioso)';
            else if (parsed.level === 1) desc = 'Alta (Toca 1 vez, destaca em vermelho, respeita silencioso)';
            else if (parsed.level === 2) desc = 'Emergência (Fica repetindo, fura o silencioso e volume no máximo)';
            
            await sock.sendMessage(remoteJid, {
              text: `✅ Configuração Global do Bot atualizada!\nO nível de alerta para todos os envios no Pushover agora é:\n*Nível ${parsed.level}:* ${desc}`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `⚠️ @${senderPhone}, ocorreu um erro ao salvar o nível de alerta global.`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        }

        else if (parsed.type === 'pushover_remove') {
          const success = await db.removeUserPushoverKey(senderJid);
          if (success) {
            await sock.sendMessage(remoteJid, {
              text: `❌ @${senderPhone}, seu Pushover User Key foi removido com sucesso!`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `⚠️ @${senderPhone}, você não possui uma chave do Pushover cadastrada.`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        }

        else if (parsed.type === 'pushover_get') {
          const key = await db.getUserPushoverKey(senderJid);
          if (key) {
            const maskedKey = key.substring(0, 4) + '...' + key.substring(key.length - 4);
            await sock.sendMessage(remoteJid, {
              text: `📋 @${senderPhone}, seu Pushover User Key cadastrado é: *${maskedKey}*`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `📋 @${senderPhone}, você não possui nenhuma chave do Pushover cadastrada. Cadastre com *!pushover <sua_chave>*`,
              mentions: [senderJid]
            }, { quoted: msg });
          }
        }
        
        else if (parsed.type === 'help') {
          const helpText = `📋 *Comandos do BossBot:*

1. *Inscrição em Bosses:*
   - \`!<nome do boss>\`: Inscreve você para receber alertas do boss.
     _Exemplo: \`!ferumbras\` ou \`!man in the cave\`_

2. *Remover Inscrição:*
   - \`!remover <nome do boss>\` ou \`!limpar <nome do boss>\`: Cancela sua inscrição daquele boss.
     _Exemplo: \`!remover ferumbras\` ou \`!limpar man in the cave\`_

3. *Listar Minhas Inscrições:*
   - \`!meusbosses\`: Mostra todos os bosses nos quais você está inscrito.

4. *Limpar Todas as Inscrições:*
   - \`!limparbosses\`: Cancela todas as suas inscrições de bosses de uma vez.

 5. *Ver Todos os Bosses (Enquetes):*
    - \`!bosses\` ou \`!enquete\`: Mostra os grupos de bosses disponíveis para votação.
    - \`!bosses <número>\`: Envia a enquete para um grupo específico de bosses.
    - \`!bosses todos\`: Envia todas as enquetes de uma vez.

6. *Confirmar Boss Vivo / Alerta:*
   - \`!confirmar <nome do boss>\` ou \`!c <nome do boss>\`: Confirma que o boss nasceu e alerta os inscritos por mensagem privada (DM) e Pushover.
   - Você também pode adicionar um comentário/localização após uma vírgula ou barra vertical.
     _Exemplo: \`!confirmar ferumbras, sala do trono\` ou \`!c man in the cave | perto da escada\`_

7. *Notificações Push (Pushover):*
   - \`!pushover <chave>\`: Cadastra seu User Key pessoal do Pushover.
   - \`!pushover remover\`: Remove seu User Key cadastrado.
   - \`!pushover\`: Consulta a chave atual configurada.

8. *Ajuda:*
   - \`!help\` ou \`!ajuda\`: Mostra esta lista de comandos.`;

          await sock.sendMessage(remoteJid, {
            text: helpText
          }, { quoted: msg });
        }

        else if (parsed.type === 'reset') {
          console.log(`[SYSTEM] Reset command received from ${senderPhone}. Restarting bot...`);
          await sock.sendMessage(remoteJid, {
            text: `🔄 Reiniciando o bot a pedido de @${senderPhone}...`,
            mentions: [senderJid]
          }, { quoted: msg });

          // Wait a brief moment to ensure the message gets sent, then close DB and exit
          setTimeout(async () => {
            try {
              await db.closeDb();
            } catch (err) {
              console.error('Error closing DB during reset:', err);
            }
            console.log('[SYSTEM] Exiting process for restart.');
            process.exit(0);
          }, 1500);
        }

        else if (parsed.type === 'bosses_menu') {
          const bossesList = loadBosses().sort((a, b) => a.localeCompare(b));
          
          if (!parsed.arg) {
            const imagePath = path.resolve('assets', 'bosses_menu.jpg');
            if (fs.existsSync(imagePath)) {
              await sock.sendMessage(remoteJid, { 
                image: fs.readFileSync(imagePath), 
                caption: `👉 *Para se inscrever ou remover, digite:*\n*!bosses <números separados por vírgula>*\nExemplo: \`!bosses 1, 5, 12\`\n\n👉 *Para se inscrever em TODOS:*\n*!bosses todos*`
              }, { quoted: msg });
            } else {
              // Fallback to text if image not found
              let menuText = `📋 *Lista de Bosses disponíveis:*\n\n`;
              bossesList.forEach((boss, idx) => {
                menuText += `${idx + 1}. ${boss}\n`;
              });
              menuText += `\n👉 *Para se inscrever ou remover, digite:*\n*!bosses <números separados por vírgula>*\nExemplo: \`!bosses 1, 5, 12\`\n\n👉 *Para se inscrever em TODOS:*\n*!bosses todos*`;

              await sock.sendMessage(remoteJid, { text: menuText }, { quoted: msg });
            }
            return;
          }

          if (parsed.arg === 'todos' || parsed.arg === 'all') {
            const promises = bossesList.map(boss => db.addSubscription(senderJid, boss));
            await Promise.all(promises);
            await sock.sendMessage(remoteJid, {
              text: `✅ @${senderPhone}, você foi inscrito em TODOS os ${bossesList.length} bosses com sucesso!`,
              mentions: [senderJid]
            }, { quoted: msg });
            return;
          }

          const args = parsed.arg.split(/[,;\s]+/).filter(Boolean);
          const validIndices = [];
          for (const a of args) {
            const num = parseInt(a, 10);
            if (!isNaN(num) && num >= 1 && num <= bossesList.length) {
              validIndices.push(num - 1);
            }
          }

          if (validIndices.length === 0) {
            await sock.sendMessage(remoteJid, {
              text: `⚠️ @${senderPhone}, não encontrei números válidos na sua mensagem. Use o comando *!bosses* para ver a lista e envie algo como \`!bosses 1, 2, 5\`.`,
              mentions: [senderJid]
            }, { quoted: msg });
            return;
          }

          const currentSubs = await db.getBossSubscriptionsForJid(senderJid);
          const currentSubsSet = new Set(currentSubs);
          
          const added = [];
          const removed = [];
          const promises = [];

          for (const idx of validIndices) {
            const bossName = bossesList[idx];
            const normalized = normalizeBossName(bossName);
            
            if (currentSubsSet.has(normalized)) {
              promises.push(db.removeSubscription(senderJid, bossName));
              removed.push(bossName);
              currentSubsSet.delete(normalized); // Previne toggle duplo na mesma mensagem
            } else {
              promises.push(db.addSubscription(senderJid, bossName));
              added.push(bossName);
              currentSubsSet.add(normalized); // Previne toggle duplo na mesma mensagem
            }
          }

          await Promise.all(promises);

          let replyText = `✅ Inscrições atualizadas com sucesso para @${senderPhone}!\n`;
          if (added.length > 0) {
            replyText += `\n➕ *Adicionados:* ${added.join(', ')}`;
          }
          if (removed.length > 0) {
            replyText += `\n➖ *Removidos:* ${removed.join(', ')}`;
          }

          await sock.sendMessage(remoteJid, {
            text: replyText,
            mentions: [senderJid]
          }, { quoted: msg });
        }
        
        else if (parsed.type === 'confirm') {
          const subscribers = await db.getSubscribers(matchedBossName);
          
          await db.addBossReport(matchedBossName, parsed.extraText, senderJid, subscribers.length);
          const correctionNotice = isCorrected ? ` (corrigido de *${parsed.bossName}*)` : '';
          const now = new Date();
          const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          if (subscribers.length === 0) {
            await sock.sendMessage(remoteJid, {
              text: `📢 *BOSS CONFIRMADO!*\n⚔️ *Boss:* ${matchedBossName.toUpperCase()}${correctionNotice}\n👤 *Por:* @${senderPhone}\n🕒 *Horário:* ${timeString}\n📭 _Não há membros inscritos para notificação no momento._`,
              mentions: [senderJid]
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, {
              text: `📢 *BOSS CONFIRMADO!*\n⚔️ *Boss:* ${matchedBossName.toUpperCase()}${correctionNotice}\n👤 *Por:* @${senderPhone}\n🕒 *Horário:* ${timeString}\n🔔 Disparando notificações\n📋 ${subscribers.length} inscrito(s)`,
              mentions: [senderJid]
            }, { quoted: msg });

            enqueueNotification(sock, subscribers, matchedBossName, parsed.extraText);
          }
        }
      } catch (err) {
        console.error('Error handling command:', err);
      }
    }
  });
}
