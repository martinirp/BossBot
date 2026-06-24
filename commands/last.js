import * as db from '../database.js';
import { findBossMatch, loadBosses, getBossCities } from '../commands.js';

export default {
  name: 'last',
  aliases: ['historico', 'histórico', 'ultimo', 'último'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o nome do boss.\nExemplo: \`${prefix}last ferumbras\``
      }, { quoted: msg });
      return;
    }

    const bossRaw = args.join(' ');
    const bossesList = loadBosses();
    const matchResult = findBossMatch(bossRaw, bossesList);

    if (!matchResult.match) {
      if (matchResult.suggestions.length > 0) {
        const s = matchResult.suggestions.map(b => `*${b}*`).join(', ');
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado. Você quis dizer: ${s}?`
        }, { quoted: msg });
      } else {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Boss *${bossRaw}* não encontrado.`
        }, { quoted: msg });
      }
      return;
    }

    const bossName = matchResult.match;
    const world = await db.getGroupWorld(remoteJid);

    // Checagem de boss multi-cidades
    const cities = getBossCities(bossName);
    if (cities) {
      const records = [];
      for (const city of cities) {
        const cityBossName = `${bossName} (${city})`;
        const record = await db.getBossLastSeen(cityBossName, world);
        records.push({ city, record });
      }

      const hasAnyRecord = records.some(r => r.record !== null);
      if (!hasAnyRecord) {
        await sock.sendMessage(remoteJid, {
          text: `⚔️ *${bossName}*\n\n📭 Nenhum avistamento registrado ainda para nenhuma cidade.`
        }, { quoted: msg });
        return;
      }

      let reply = `⚔️ *${bossName}*\n\n`;
      const mentions = [];
      for (const item of records) {
        reply += `📍 *${item.city}*:\n`;
        if (item.record) {
          const phone = item.record.confirmed_by.split('@')[0];
          reply += `👁️ Último avistamento: *${item.record.seen_at}*\n👤 Por: @${phone}\n\n`;
          mentions.push(item.record.confirmed_by);
        } else {
          reply += `📭 Nenhum avistamento registrado ainda.\n\n`;
        }
      }

      await sock.sendMessage(remoteJid, {
        text: reply.trim(),
        mentions
      }, { quoted: msg });
      return;
    }

    const record = await db.getBossLastSeen(bossName, world);

    if (!record) {
      await sock.sendMessage(remoteJid, {
        text: `⚔️ *${bossName}*\n\n📭 Nenhum avistamento registrado ainda.`
      }, { quoted: msg });
      return;
    }

    const phone = record.confirmed_by.split('@')[0];
    const cityText = record.city ? ` (${record.city})` : '';
    await sock.sendMessage(remoteJid, {
      text: `⚔️ *${bossName}*\n\n👁️ Último avistamento: *${record.seen_at}*${cityText}\n👤 Por: @${phone}`,
      mentions: [record.confirmed_by]
    }, { quoted: msg });
  }
}
