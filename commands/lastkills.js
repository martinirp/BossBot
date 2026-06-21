import { loadBosses, normalizeBossName } from '../commands.js';

export default {
  name: 'lastkills',
  aliases: ['mortos', 'bossesmortos', 'ontem'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    if (args.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Informe o mundo.\nExemplo: \`${prefix}lastkills Quelibra\``
      }, { quoted: msg });
      return;
    }

    const worldName = args[0];
    const world = worldName.charAt(0).toUpperCase() + worldName.slice(1).toLowerCase();

    try {
      const response = await fetch(`https://api.tibiadata.com/v4/killstatistics/${world}`);
      if (!response.ok) {
        throw new Error('Falha na comunicação com a API do TibiaData.');
      }
      const data = await response.json();
      
      if (!data.killstatistics || !data.killstatistics.entries) {
        await sock.sendMessage(remoteJid, {
            text: `⚠️ Mundo *${world}* não encontrado ou sem dados no TibiaData.`
        }, { quoted: msg });
        return;
      }

      const rawBossesList = loadBosses();
      const normalizedBosses = new Set(rawBossesList.map(b => normalizeBossName(b)));

      const entries = data.killstatistics.entries;
      let killedYesterday = [];

      for (const entry of entries) {
        if (entry.last_day_killed > 0) {
           const normRace = normalizeBossName(entry.race);
           if (normalizedBosses.has(normRace)) {
              killedYesterday.push({
                 name: entry.race,
                 count: entry.last_day_killed
              });
           }
        }
      }

      if (killedYesterday.length === 0) {
        await sock.sendMessage(remoteJid, {
            text: `🌍 *${world}*\n\nNenhum dos bosses monitorados foi morto ontem.`
        }, { quoted: msg });
        return;
      }

      killedYesterday.sort((a, b) => b.count - a.count);

      let textMsg = `🌍 *${world}* - Bosses mortos ontem:\n\n`;
      for (const b of killedYesterday) {
         textMsg += `💀 *${b.name}* (${b.count}x)\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: textMsg
      }, { quoted: msg });

    } catch (err) {
      console.error('[lastkills] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro ao consultar a API do TibiaData. Verifique se o nome do mundo está correto.`
      }, { quoted: msg });
    }
  }
}
