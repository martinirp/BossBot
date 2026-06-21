import * as db from '../database.js';
import fs from 'fs';
import path from 'path';

export default {
  name: 'previsao',
  aliases: ['chances', 'tracker'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    await sock.sendMessage(remoteJid, {
        text: `🔍 Calculando previsões de bosses...`
    });

    try {
      const statsPath = path.resolve('bosses_stats.json');
      let stats = {};
      if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      }

      const allSeen = await db.getAllBossesLastSeen();
      
      let bosses = [];

      for (const record of allSeen) {
         const bName = record.boss_name;
         if (!stats[bName]) continue;

         const minDays = stats[bName].min_days || 0;
         const maxDays = stats[bName].max_days || 0;
         if (minDays === 0 || maxDays === 0) continue;

         const minHours = minDays * 24;
         const maxHours = maxDays * 24;

         // A data no banco "seen_at" está em formato "YYYY-MM-DD HH:mm" no UTC-3
         const seenDate = new Date(record.seen_at.replace(' ', 'T') + ':00Z');
         
         const nowUtc3 = new Date();
         nowUtc3.setHours(nowUtc3.getHours() - 3);
         const nowFakeUtc = new Date(nowUtc3.toISOString().replace('T', ' ').substring(0, 19).replace(' ', 'T') + 'Z');
         
         const diffHours = (nowFakeUtc - seenDate) / (1000 * 60 * 60);

         let chance = 0;
         if (diffHours < minHours) {
            chance = 0;
         } else if (diffHours >= maxHours) {
            chance = 100;
         } else {
            chance = Math.floor(((diffHours - minHours) / (maxHours - minHours)) * 100);
         }

         bosses.push({
            name: bName,
            chance_percent: chance,
            diff_hours: Math.floor(diffHours)
         });
      }

      if (bosses.length === 0) {
         await sock.sendMessage(remoteJid, {
            text: `⚠️ Nenhuma previsão possível. Nenhum boss foi registrado ou configurado com mínimo/máximo de dias.`
         }, { quoted: msg });
         return;
      }

      // Ordena pelas maiores chances
      bosses.sort((a, b) => b.chance_percent - a.chance_percent);

      let textMsg = `📊 *Previsão de Bosses*\n\n`;

      const altas = [];
      for (const b of bosses) {
          if (b.chance_percent >= 60 && b.chance_percent <= 99) altas.push(b);
      }

      if (altas.length > 0) {
         for (const b of altas) {
            textMsg += `> 💀 *${b.name}* - ${b.chance_percent}%\n`;
         }
      } else {
         textMsg += `😴 Nenhum boss com chance entre 60% e 99% no momento.\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: textMsg.trim()
      }, { quoted: msg });

    } catch (err) {
      console.error('[previsao] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro interno ao calcular as previsões.`
      }, { quoted: msg });
    }
  }
}
