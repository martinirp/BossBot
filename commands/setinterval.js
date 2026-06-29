import fs from 'fs';
import path from 'path';
import { findBossMatch, loadBosses } from '../commands.js';

export default {
  name: 'setinterval',
  aliases: ['definirintervalo', 'intervalo'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    const rawInput = args.join(' ');
    const parts = rawInput.split(',').map(p => p.trim()).filter(p => p.length > 0);

    if (parts.length < 3) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Uso correto: \`${prefix}setinterval <boss>, <min>, <max>\`\nExemplo: \`${prefix}setinterval Captain Jones, 6, 8\``
      }, { quoted: msg });
      return;
    }

    const bossRaw = parts[0];
    const minStr = parts[1];
    const maxStr = parts[2];

    const minVal = parseInt(minStr, 10);
    const maxVal = parseInt(maxStr, 10);

    if (isNaN(minVal) || isNaN(maxVal) || minVal < 0 || maxVal < 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Os valores de mínimo e máximo devem ser números inteiros maiores ou iguais a 0.`
      }, { quoted: msg });
      return;
    }

    if (minVal > maxVal) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ O valor mínimo (${minVal}) não pode ser maior que o valor máximo (${maxVal}).`
      }, { quoted: msg });
      return;
    }

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
          text: `⚠️ Boss *${bossRaw}* não foi encontrado. Verifique a grafia.`
        }, { quoted: msg });
      }
      return;
    }

    const matchedBossName = matchResult.match;

    try {
      const jsonPath = path.resolve('boss_intervals.json');
      const jsPath = path.resolve('bossIntervals.js');

      if (!fs.existsSync(jsonPath)) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ O arquivo boss_intervals.json não foi encontrado no servidor.`
        }, { quoted: msg });
        return;
      }

      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

      if (!data[matchedBossName]) {
        data[matchedBossName] = {};
      }
      if (!data[matchedBossName].fixedDaysFrequency) {
        data[matchedBossName].fixedDaysFrequency = {};
      }

      data[matchedBossName].fixedDaysFrequency.min = minVal;
      data[matchedBossName].fixedDaysFrequency.max = maxVal;

      // Grava no JSON
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

      // Grava no JS exportável
      const jsContent = `export const bossIntervals = ${JSON.stringify(data, null, 2)};\n`;
      fs.writeFileSync(jsPath, jsContent, 'utf8');

      await sock.sendMessage(remoteJid, {
        text: `✅ Intervalo do boss *${matchedBossName}* atualizado com sucesso!\n📅 Novo intervalo: de *${minVal}* a *${maxVal}* dias.`
      }, { quoted: msg });

    } catch (err) {
      console.error('[setinterval] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao salvar os novos intervalos no servidor.`
      }, { quoted: msg });
    }
  }
};
