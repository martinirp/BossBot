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

      const alta = [];
      const media = [];

      // O tracker já retorna ordenado pelas maiores chances
      for (const b of bosses) {
          if (b.chance_percent >= 90) alta.push(b);
          else if (b.chance_percent >= 80) media.push(b);
      }

      if (alta.length > 0) {
         textMsg += `🔴 *Pode Nascer (>= 90%)*\n`;
         for (const b of alta) {
            textMsg += `> 💀 *${b.name}* - ${b.chance_percent}%\n`;
         }
         textMsg += `\n`;
      }

      if (media.length > 0) {
         textMsg += `🟠 *Alta Chance (80% - 89%)*\n`;
         for (const b of media) {
            textMsg += `> 💀 *${b.name}* - ${b.chance_percent}%\n`;
         }
         textMsg += `\n`;
      }

      if (alta.length === 0 && media.length === 0) {
         textMsg += `😴 Nenhum boss com alta chance no momento.\n\n`;
         textMsg += `*Top 3 mais próximos:*\n`;
         let count = 0;
         for (const b of bosses) {
             if (b.status !== 'Sem dados' && b.status !== 'Sincronizando média...' && count < 3) {
                 textMsg += `> 💀 *${b.name}* - ${b.chance_percent}% (${b.days_since}/${b.expected_days} dias)\n`;
                 count++;
             }
         }
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
