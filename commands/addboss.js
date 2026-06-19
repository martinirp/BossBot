import fs from 'fs';
import path from 'path';
import * as db from '../database.js';
import { normalizeBossName, findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'addboss',
  aliases: ['adicionarboss'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone, prefix } = context;
    const bossesList = loadBosses();

    if (args.length === 0) {
      const imagePath = path.resolve('assets', 'bosses_menu.jpg');
      if (fs.existsSync(imagePath)) {
        await sock.sendMessage(remoteJid, {
          image: fs.readFileSync(imagePath),
          caption: `👉 *Para se inscrever ou remover, digite:*\n*${prefix}addboss <números separados por vírgula>*\nExemplo: \`${prefix}addboss 1, 5, 12\`\n\n👉 *Para se inscrever em TODOS:*\n*${prefix}addall*`
        }, { quoted: msg });

        if (bossesList.length > 96) {
          let extraText = `📝 *Bosses adicionados que não constam na imagem:*\n`;
          for (let i = 96; i < bossesList.length; i++) {
            extraText += `*${i + 1}.* ${bossesList[i]}\n`;
          }
          await sock.sendMessage(remoteJid, { text: extraText.trim() }, { quoted: msg });
        }
      } else {
        let menuText = `📋 *Lista de Bosses disponíveis:*\n\n`;
        bossesList.forEach((boss, idx) => {
          menuText += `${idx + 1}. ${boss}\n`;
        });
        menuText += `\n👉 *Para se inscrever ou remover, digite:*\n*${prefix}addboss <números separados por vírgula>*\nExemplo: \`${prefix}addboss 1, 5, 12\`\n\n👉 *Para se inscrever em TODOS:*\n*${prefix}addall*`;
        await sock.sendMessage(remoteJid, { text: menuText }, { quoted: msg });
      }
      return;
    }

    if (args[0] === 'todos' || args[0] === 'all') {
      const promises = bossesList.map(boss => db.addSubscription(senderJid, boss));
      await Promise.all(promises);
      await sock.sendMessage(remoteJid, {
        text: `✅ @${senderPhone}, você foi inscrito em TODOS os ${bossesList.length} bosses com sucesso!`,
        mentions: [senderJid]
      }, { quoted: msg });
      return;
    }

    const inputString = args.join(' ');
    const parts = inputString.split(/[,;\s]+/).filter(Boolean);
    const validIndices = [];
    let isNumericMode = false;

    if (!isNaN(parseInt(parts[0], 10))) {
      isNumericMode = true;
      for (const a of parts) {
        const num = parseInt(a, 10);
        if (!isNaN(num) && num >= 1 && num <= bossesList.length) {
          validIndices.push(num - 1);
        }
      }
    }

    if (isNumericMode) {
      if (validIndices.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ @${senderPhone}, não encontrei números válidos na sua mensagem. Use o comando *${prefix}bosses* para ver a lista e envie algo como \`${prefix}addboss 1, 2, 5\`.`,
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
          currentSubsSet.delete(normalized);
        } else {
          promises.push(db.addSubscription(senderJid, bossName));
          added.push(bossName);
          currentSubsSet.add(normalized);
        }
      }

      await Promise.all(promises);

      let replyText = `✅ Inscrições atualizadas com sucesso para @${senderPhone}!\n`;
      if (added.length > 0) replyText += `\n➕ *Adicionados:* ${added.join(', ')}`;
      if (removed.length > 0) replyText += `\n➖ *Removidos:* ${removed.join(', ')}`;

      await sock.sendMessage(remoteJid, { text: replyText, mentions: [senderJid] }, { quoted: msg });
      return;
    }

    const bossesToParse = inputString.split(',').map(b => normalizeBossName(b)).filter(Boolean);
    if (bossesToParse.length === 0) return;

    const successList = [];
    const alreadyList = [];
    const notFoundList = [];

    const originalParts = inputString.split(',');
    for (const bossInput of originalParts) {
      if (!bossInput.trim()) continue;
      const matchResult = findBossMatch(bossInput, bossesList);
      if (matchResult.match) {
        const success = await db.addSubscription(senderJid, matchResult.match);
        if (success) successList.push(matchResult.match);
        else alreadyList.push(matchResult.match);
      } else {
        notFoundList.push(bossInput.trim());
      }
    }

    let responseText = ``;
    if (successList.length > 0) responseText += `✅ Inscrito: ${successList.map(b => `*${b}*`).join(', ')}\n`;
    if (alreadyList.length > 0) responseText += `ℹ️ Já inscrito: ${alreadyList.map(b => `*${b}*`).join(', ')}\n`;
    if (notFoundList.length > 0) responseText += `❌ Não encontrado: ${notFoundList.map(b => `*${b}*`).join(', ')}\n`;

    if (responseText) {
      await sock.sendMessage(remoteJid, {
        text: `@${senderPhone}\n${responseText.trim()}`,
        mentions: [senderJid]
      }, { quoted: msg });
    }
  }
}
