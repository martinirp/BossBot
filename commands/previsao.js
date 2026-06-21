export default {
  name: 'previsao',
  aliases: ['chances', 'tracker'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, prefix } = context;

    let world = 'Quelibra'; // Padrão
    if (args.length > 0) {
      world = args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase();
    }

    await sock.sendMessage(remoteJid, {
        text: `🔍 Buscando previsões do Boss Tracker para *${world}*...`
    });

    try {
      // Como o tracker roda na mesma máquina (VPS), acessamos via localhost na porta 3000
      const response = await fetch(`http://localhost:3000/api/bosses/${world}`);
      
      if (!response.ok) {
         throw new Error(`Erro HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const bosses = data.bosses || [];

      if (bosses.length === 0) {
         await sock.sendMessage(remoteJid, {
            text: `⚠️ Nenhuma previsão encontrada para o mundo *${world}*.`
         }, { quoted: msg });
         return;
      }

      let textMsg = `📊 *Previsão de Bosses - ${world}*\n\n`;

      const altas = [];

      for (const b of bosses) {
          if (b.chance_percent >= 80) altas.push(b);
      }

      if (altas.length > 0) {
         for (const b of altas) {
            textMsg += `> 💀 *${b.name}* - ${b.chance_percent}%\n`;
         }
      } else {
         textMsg += `😴 Nenhum boss com alta chance no momento.\n`;
      }

      await sock.sendMessage(remoteJid, {
        text: textMsg.trim()
      }, { quoted: msg });

    } catch (err) {
      console.error('[previsao] Error:', err);
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Erro ao comunicar com o Boss Tracker. Ele está rodando na porta 3000 do servidor?`
      }, { quoted: msg });
    }
  }
}
