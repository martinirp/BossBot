import * as db from '../database.js';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  name: 'rank',
  aliases: ['ranking'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, isGroup } = context;

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthName = MONTH_NAMES[now.getMonth()];

    const rows = await db.getMonthlyRank(month, year);

    if (rows.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `🏆 *Ranking de ${monthName}/${year}*\n\nNenhum boss foi confirmado este mês ainda. Seja o primeiro!`
      }, { quoted: msg });
      return;
    }

    // Tenta resolver nomes dos participantes usando o banco de dados
    const nameMap = await db.getAllUserNames();
    
    // Fallback: se ainda quiser tentar pegar do metadata caso falte no BD (embora baileys moderno nao traga notify por padrao)
    if (isGroup) {
      try {
        const metadata = await sock.groupMetadata(remoteJid);
        for (const p of metadata.participants) {
          if (!nameMap[p.id] && (p.notify || p.name)) {
            nameMap[p.id] = p.notify || p.name;
          }
        }
      } catch (_) { /* silently fail */ }
    }

    let text = `🏆 *Ranking de ${monthName}/${year}*\n\n`;
    rows.forEach((row, idx) => {
      const medal = MEDALS[idx] || `${idx + 1}.`;
      const name = nameMap[row.jid] || row.jid.split('@')[0];
      const plural = row.count === 1 ? 'boss' : 'bosses';
      text += `${medal} *${name}* — ${row.count} ${plural}\n`;
    });

    await sock.sendMessage(remoteJid, { text: text.trim() }, { quoted: msg });
  }
}
