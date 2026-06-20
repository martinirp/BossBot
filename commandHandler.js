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
    
    // Suporte aos prefixos ! e /
    if (!trimmed.startsWith('!') && !trimmed.startsWith('/')) return;
    
    const prefix = trimmed[0];
    const withoutPrefix = trimmed.slice(1).trim();
    if (!withoutPrefix) return;

    // Split command and arguments
    const args = withoutPrefix.split(/\s+/);
    const cmdName = args.shift().toLowerCase();
    
    // Prepara o contexto
    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    const senderJid = jidNormalizedUser(msg.key.participant || remoteJid);
    const senderPhone = senderJid.split('@')[0];
    const allowedGroups = await db.getAllowedGroups();

    const context = {
      sock, msg, text, trimmed, withoutPrefix, prefix,
      remoteJid, isGroup, senderJid, senderPhone, allowedGroups
    };

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

  async executeCommand(command, args, context) {
    // Validação de Permissão e DM
    let isAllowed = false;

    if (context.isGroup) {
      if (context.allowedGroups.includes(context.remoteJid)) {
        isAllowed = true;
      } else {
        // Em grupos não cadastrados, só permite o addgroup
        if (command.name === 'addgroup') {
          isAllowed = true;
        }
      }
    } else {
      // Regras de DM
      if (command.name === 'confirm') {
        await context.sock.sendMessage(context.remoteJid, {
          text: `⚠️ O comando de confirmar o boss só pode ser usado no grupo oficial para alertar a todos!`
        }, { quoted: context.msg });
        return;
      }

      if (context.allowedGroups.length > 0) {
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
          return;
        }
      }
    }

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
}

export const commandHandler = new CommandHandler();
