import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { normalizeBossName, findBossMatch, loadBosses } from './commands.js';
import * as db from './database.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

class CommandHandler {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
    this.pendingPrompts = new Map();
    this.activePolls = new Map();
  }

  setPrompt(remoteJid, senderJid, promptData) {
    const key = `${remoteJid}:${senderJid}`;
    this.pendingPrompts.set(key, { ...promptData, timestamp: Date.now() });
  }

  getPrompt(remoteJid, senderJid) {
    const key = `${remoteJid}:${senderJid}`;
    const prompt = this.pendingPrompts.get(key);
    if (!prompt) return null;
    // Timeout of 2 minutes
    if (Date.now() - prompt.timestamp > 120000) {
      this.pendingPrompts.delete(key);
      return null;
    }
    return prompt;
  }

  clearPrompt(remoteJid, senderJid) {
    const key = `${remoteJid}:${senderJid}`;
    this.pendingPrompts.delete(key);
  }

  async loadCommands() {
    const commandsDir = path.resolve('commands');
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      const filePath = path.join(commandsDir, file);
      try {
        const module = await import(pathToFileURL(filePath).href);
        const cmd = module.default;
        if (cmd && cmd.name && cmd.execute) {
          this.commands.set(cmd.name, cmd);
          if (cmd.aliases && Array.isArray(cmd.aliases)) {
            for (const alias of cmd.aliases) {
              this.aliases.set(alias, cmd.name);
            }
          }
        }
      } catch (err) {
        console.error(`[CommandHandler] Failed to load command ${file}:`, err);
      }
    }
    console.log(`[CommandHandler] Loaded ${this.commands.size} commands.`);
  }

  getCommand(name) {
    const lowerName = name.toLowerCase();
    if (this.commands.has(lowerName)) {
      return this.commands.get(lowerName);
    }
    if (this.aliases.has(lowerName)) {
      return this.commands.get(this.aliases.get(lowerName));
    }
    return null;
  }

  async handleMessage(sock, msg, text) {
    if (!text) return;
    const trimmed = text.trim();

    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    const senderJid = jidNormalizedUser(msg.key.participant || remoteJid);
    const senderPhone = senderJid.split('@')[0];
    const senderName = msg.pushName || '';
    if (senderName) {
      db.upsertUser(senderJid, senderName).catch(() => {});
    }
    const allowedGroups = await db.getAllowedGroups();

    const context = {
      sock, msg, text, trimmed,
      remoteJid, isGroup, senderJid, senderPhone, allowedGroups,
      commandHandler: this
    };

    // --- Interactive Prompt Interception ---
    const prompt = this.getPrompt(remoteJid, senderJid);
    if (prompt) {
      const optionIndex = parseInt(trimmed, 10);
      this.clearPrompt(remoteJid, senderJid); // Clear prompt regardless of input
      
      if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= prompt.cities.length) {
        const selectedCity = prompt.cities[optionIndex - 1];
        // Reconstruct the confirmation command (e.g., "!confirm danimax, Thais")
        const reconstructedCommandText = `${prompt.prefix}confirm ${prompt.bossName}, ${selectedCity}`;
        console.log(`[CommandHandler] Intercepted prompt reply from ${senderPhone}: ${reconstructedCommandText}`);
        
        const args = reconstructedCommandText.slice(1).trim().split(/\s+/);
        const cmdName = args.shift().toLowerCase();
        
        context.text = reconstructedCommandText;
        context.trimmed = reconstructedCommandText;
        context.withoutPrefix = reconstructedCommandText.slice(1).trim();
        context.prefix = prompt.prefix;
        
        const command = this.getCommand(cmdName);
        if (command) {
          await this.executeCommand(command, args, context);
          return;
        }
      } else {
        console.log(`[CommandHandler] Prompt cancelled by ${senderPhone} due to invalid/non-numeric input.`);
        // Fall through to process the message normally
      }
    }

    // --- Numeric Menu Interception (Global per Chat) ---
    // Verifica se a mensagem é apenas um número
    const possibleNumber = parseInt(trimmed, 10);
    if (!isNaN(possibleNumber) && trimmed === String(possibleNumber)) {
      // Procura algum menu ativo neste grupo
      for (const [pollId, menuPrompt] of this.activePolls.entries()) {
        if (menuPrompt.type === 'numeric_menu' && menuPrompt.remoteJid === remoteJid) {
          if (possibleNumber >= 1 && possibleNumber <= menuPrompt.cities.length) {
            const selectedCity = menuPrompt.cities[possibleNumber - 1];
            const reconstructedCommandText = `${menuPrompt.prefix}confirm ${menuPrompt.bossName}, ${selectedCity} --silent`;
            
            const args = reconstructedCommandText.slice(1).trim().split(/\s+/);
            const cmdName = args.shift().toLowerCase();
            
            context.text = reconstructedCommandText;
            context.trimmed = reconstructedCommandText;
            context.withoutPrefix = reconstructedCommandText.slice(1).trim();
            context.prefix = menuPrompt.prefix;
            
            const command = this.getCommand(cmdName);
            if (command) {
               try {
                  // Deleta a mensagem do menu (do bot)
                  const botJid = jidNormalizedUser(sock.user.id);
                  await sock.sendMessage(remoteJid, { delete: { remoteJid, id: pollId, fromMe: true, participant: botJid } });
                  // Deleta o número que o usuário digitou
                  await sock.sendMessage(remoteJid, { delete: msg.key });
               } catch(e) {
                   console.log("[CommandHandler] Nao foi possivel apagar a mensagem numerica:", e);
               }
               
               this.activePolls.delete(pollId); // Evita chamadas duplicadas
               await this.executeCommand(command, args, context);
               return;
            }
          }
        }
      }
    }

    // --- Poll Interception (Deprecated/Failing in Baileys for @lid) ---
    // Auto-calculador do Hive (Loot of a spidris elite / hive overseer)
    const hiveRegex = /(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?\s+Loot\s+of\s+a\s+(spidris\s+elite|hive\s+overseer):/i;
    const match = trimmed.match(hiveRegex);
    if (match) {
      const allowed = await this.checkPermission(context);
      if (!allowed) return;

      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = match[3] !== undefined ? parseInt(match[3], 10) : 0;
      const showSeconds = match[3] !== undefined;

      const formatTime = (t) => {
        const pad = (n) => String(n).padStart(2, '0');
        if (showSeconds) {
          return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
        } else {
          return `${pad(t.h)}:${pad(t.m)}`;
        }
      };

      const addMinutes = (h, m, s, minToAdd) => {
        let totalSeconds = h * 3600 + m * 60 + s + minToAdd * 60;
        totalSeconds = totalSeconds % 86400;
        if (totalSeconds < 0) totalSeconds += 86400;
        
        const newH = Math.floor(totalSeconds / 3600);
        const newM = Math.floor((totalSeconds % 3600) / 60);
        const newS = totalSeconds % 60;
        return { h: newH, m: newM, s: newS };
      };

      const inputTimeStr = formatTime({ h: hours, m: minutes, s: seconds });
      const time16 = formatTime(addMinutes(hours, minutes, seconds, 16));
      const time22 = formatTime(addMinutes(hours, minutes, seconds, 22));
      const time28 = formatTime(addMinutes(hours, minutes, seconds, 28));

      const response = `Último Hive: ${inputTimeStr}\n` +
                       `Próxima aparição: (16-28 min)\n` +
                       `20% → ${time16} (16m)\n` +
                       `40% → ${time22} (22m)\n` +
                       `40% → ${time28} (28m)`;

      try {
        const now = new Date();
        // ✅ FIX: usa getUTCHours() para calcular BRT corretamente,
        // independente do fuso da máquina onde o bot está rodando.
        now.setUTCHours(now.getUTCHours() - 3); // UTC → BRT (UTC-3)
        const savedAt = now.toISOString().replace('T', ' ').substring(0, 16);
        const hiveData = {
          response,
          savedAt,
          reportedBy: senderPhone
        };
        await db.setGlobalSetting('last_hive', JSON.stringify(hiveData));
      } catch (err) {
        console.error('[CommandHandler] Failed to save last hive to DB:', err);
      }

      await sock.sendMessage(context.remoteJid, { text: response }, { quoted: msg });
      return;
    }
    
    // Suporte aos prefixos ! e /
    if (!trimmed.startsWith('!') && !trimmed.startsWith('/')) return;
    
    const prefix = trimmed[0];
    const withoutPrefix = trimmed.slice(1).trim();
    if (!withoutPrefix) return;

    // Split command and arguments
    const args = withoutPrefix.split(/\s+/);
    const cmdName = args.shift().toLowerCase();
    
    // Atualiza o context com prefix e withoutPrefix
    context.prefix = prefix;
    context.withoutPrefix = withoutPrefix;

    const command = this.getCommand(cmdName);

    if (command) {
      await this.executeCommand(command, args, context);
      return;
    }

    // --- FALLBACK (Comportamento Oculto Antigo) ---
    // Se o comando não foi encontrado na lista, tentamos ver se é um nome de boss
    // Isso mantém a compatibilidade com comandos antigos como "!ferumbras, zomba"
    
    // Tratamento especial para "!todos" como fallback para "!bosses todos" caso não seja pego pelo command
    if (cmdName === 'todos' || cmdName === 'all') {
       const addallCmd = this.getCommand('addall');
       if (addallCmd) {
           await this.executeCommand(addallCmd, args, context);
           return;
       }
     }

    // Verifica se os termos digitados correspondem a pelo menos um boss válido
    const bossesList = loadBosses();
    const parts = withoutPrefix.split(/[,;\s]+/).filter(Boolean);
    let hasAnyValidBoss = false;

    for (const part of parts) {
      const matchResult = findBossMatch(part, bossesList);
      if (matchResult.match) {
        hasAnyValidBoss = true;
        break;
      }
    }

    if (hasAnyValidBoss) {
      const fallbackCmd = this.getCommand('addboss');
      if (fallbackCmd) {
        // Reconstroi os argumentos como se fosse "!addboss <boss_list>"
        // O withoutPrefix inteiro é passado como argumento.
        const fallbackArgs = withoutPrefix.split(',');
        await this.executeCommand(fallbackCmd, fallbackArgs, context);
      }
    } else {
      // Se não for comando válido nem corresponder a nenhum boss, exibe aviso
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Comando ou boss *"${prefix}${cmdName}"* não reconhecido.\n👉 Digite *${prefix}help* para ver a lista de comandos disponíveis.`
      }, { quoted: msg });
    }
  }

  async checkPermission(context, commandName = null) {
    if (context.isGroup) {
      if (context.allowedGroups.includes(context.remoteJid)) {
        return true;
      }
      // Em grupos não cadastrados, só permite o addgroup
      if (commandName === 'addgroup') {
        return true;
      }
      return false;
    } else {
      // Regras de DM
      if (commandName === 'confirm') {
        await context.sock.sendMessage(context.remoteJid, {
          text: `⚠️ O comando de confirmar o boss só pode ser usado no grupo oficial para alertar a todos!`
        }, { quoted: context.msg });
        return false;
      }

      if (context.allowedGroups.length > 0) {
        let isAllowed = false;
        try {
          for (const groupJid of context.allowedGroups) {
            const metadata = await context.sock.groupMetadata(groupJid);
            const isMember = metadata.participants.some(p => p.id === context.senderJid);
            if (isMember) {
              isAllowed = true;
              break;
            }
          }
        } catch (err) {
          console.error('Erro ao buscar metadados de grupos para validar DM:', err);
        }

        if (!isAllowed) {
          await context.sock.sendMessage(context.remoteJid, {
            text: `🚫 Acesso Negado! O BossBot é exclusivo para membros dos grupos oficiais.`
          }, { quoted: context.msg });
          return false;
        }
        return isAllowed;
      }
      return false;
    }
  }

  async executeCommand(command, args, context) {
    const isAllowed = await this.checkPermission(context, command.name);
    if (!isAllowed) return;

    try {
      await command.execute(context, args);
    } catch (err) {
      console.error(`[CommandHandler] Error executing command ${command.name}:`, err);
      await context.sock.sendMessage(context.remoteJid, {
        text: `⚠️ Ocorreu um erro ao executar este comando.`
      }, { quoted: context.msg });
    }
  }

  async handlePollUpdate(sock, msg) {
    try {
      console.log("[CommandHandler] Processando pollUpdateMessage...");
      const { getAggregateVotesInPollMessage, decryptPollVote, jidNormalizedUser } = await import('@whiskeysockets/baileys');
      const pollCreationKey = msg.message.pollUpdateMessage.pollCreationMessageKey;
      const pollId = pollCreationKey.id;
      
      console.log(`[CommandHandler] Poll ID recebido: ${pollId}`);
      const pollData = this.activePolls.get(pollId);
      if (!pollData) {
        console.log(`[CommandHandler] Enquete ${pollId} não encontrada em activePolls.`);
        return;
      }
      console.log(`[CommandHandler] Enquete encontrada! Boss: ${pollData.bossName}`);
      
      const pollEncKey = pollData.originalMessage?.message?.messageContextInfo?.messageSecret || pollData.originalMessage?.messageContextInfo?.messageSecret;
      if (!pollEncKey) {
          console.log("[CommandHandler] messageSecret não encontrado na mensagem original.");
          console.log("Original message keys:", Object.keys(pollData.originalMessage));
          return;
      }
      
      const meId = jidNormalizedUser(sock.user.id);
      
      let participantsToTry = [];
      if (msg.key.fromMe) {
          participantsToTry.push(meId);
      } else {
          // Tenta o JID original que veio na mensagem (pode ser o @lid)
          if (msg.key.participant) participantsToTry.push(msg.key.participant);
          
          // Se for grupo, busca a lista real de JIDs (telefone) dos membros e adiciona
          if (msg.key.remoteJid.endsWith('@g.us')) {
              try {
                  const metadata = await sock.groupMetadata(msg.key.remoteJid);
                  for (const p of metadata.participants) {
                      if (p.id) participantsToTry.push(p.id);
                  }
              } catch(e) {
                  console.log("[CommandHandler] Erro ao buscar metadata do grupo para bruteforce:", e);
              }
          }
      }
      
      // Expandir lista com possíveis sufixos de device para contornar a assinatura
      let expandedParticipants = [];
      for (const p of participantsToTry) {
          const base = jidNormalizedUser(p);
          expandedParticipants.push(base);
          expandedParticipants.push(p); // Mantém o original (pode já ter sufixo)
          const [num, domain] = base.split('@');
          for (let i = 1; i <= 5; i++) {
              expandedParticipants.push(`${num}:${i}@${domain}`);
          }
      }
      
      // Remove duplicatas
      participantsToTry = [...new Set(expandedParticipants)];

      let voteMsg = null;
      let trueVoterJid = null;
      
      for (const pJid of participantsToTry) {
          try {
              voteMsg = decryptPollVote(
                  msg.message.pollUpdateMessage.vote,
                  {
                      pollEncKey,
                      pollCreatorJid: meId,
                      pollMsgId: pollId,
                      voterJid: pJid
                  }
              );
              trueVoterJid = pJid;
              break; // BINGO! Descriptografou com sucesso
          } catch (e) {
              // Assinatura falhou para este JID, tenta o próximo
          }
      }
      
      if (!voteMsg) {
          console.log("[CommandHandler] FALHA CRÍTICA: Não foi possível descriptografar o voto com nenhum dos", participantsToTry.length, "JIDs testados.");
          return;
      }
      
      console.log(`[CommandHandler] Voto descriptografado com sucesso! Burlou o @lid usando o JID real: ${trueVoterJid}`);

      const pollUpdateResult = getAggregateVotesInPollMessage({
          message: pollData.originalMessage.message || pollData.originalMessage,
          pollUpdates: [{
              pollUpdateMessageKey: msg.key,
              vote: voteMsg
          }],
      });
      console.log(`[CommandHandler] pollUpdateResult:`, JSON.stringify(pollUpdateResult, null, 2));

      let selectedOption = null;
      let voterJid = null;
      for (const opt of pollUpdateResult) {
          if (opt.voters.length > 0) {
              selectedOption = opt.name;
              voterJid = opt.voters[0];
              break;
          }
      }

      if (selectedOption) {
          console.log(`[CommandHandler] Voto capturado! Opção: ${selectedOption}`);
          this.activePolls.delete(pollId); // prevent multiple triggers
          
          try {
              await sock.sendMessage(pollCreationKey.remoteJid, { delete: pollCreationKey });
          } catch(e) { console.error("[CommandHandler] Failed to delete poll:", e); }
          
          const reconstructedCommandText = `${pollData.prefix}confirm ${pollData.bossName}, ${selectedOption}`;
          console.log(`[CommandHandler] Intercepted poll reply from ${voterJid}: ${reconstructedCommandText}`);
          
          const args = reconstructedCommandText.slice(1).trim().split(/\s+/);
          const cmdName = args.shift().toLowerCase();
          
          const voterPhone = voterJid ? voterJid.split('@')[0] : '';
          const allowedGroups = await db.getAllowedGroups();
          
          const context = {
              sock, 
              msg: { key: msg.key }, // minimal mock msg
              text: reconstructedCommandText, 
              trimmed: reconstructedCommandText,
              withoutPrefix: reconstructedCommandText.slice(1).trim(),
              prefix: pollData.prefix,
              remoteJid: pollCreationKey.remoteJid,
              isGroup: pollCreationKey.remoteJid.endsWith('@g.us'),
              senderJid: voterJid,
              senderPhone: voterPhone,
              allowedGroups: allowedGroups,
              commandHandler: this
          };
          
          const command = this.getCommand(cmdName);
          if (command) {
              await this.executeCommand(command, args, context);
          }
      }
    } catch(e) {
      console.error("[CommandHandler] Error handling poll update:", e);
    }
  }
}

export const commandHandler = new CommandHandler();
