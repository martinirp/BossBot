import * as db from '../database.js';
import { execSync } from 'child_process';

export default {
  name: 'reset',
  aliases: [],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderJid, senderPhone } = context;

    console.log(`[SYSTEM] Reset command received from ${senderPhone}. Running git pull...`);

    // Executa o git pull capturando stdout e stderr
    let gitOutput = '';
    try {
      gitOutput = execSync('git pull 2>&1', { cwd: process.cwd(), encoding: 'utf8' }).trim();
    } catch (err) {
      const out = err.stdout?.toString().trim() || '';
      const rederr = err.stderr?.toString().trim() || '';
      gitOutput = out || rederr || err.message || 'Erro desconhecido no git pull.';
    }

    console.log(`[SYSTEM] git pull output:\n${gitOutput}`);

    await sock.sendMessage(remoteJid, {
      text: `🔄 *Git Pull* (pedido por @${senderPhone})\n\n\`\`\`\n${gitOutput}\n\`\`\`\n\n♻️ Reiniciando o bot...`,
      mentions: [senderJid]
    }, { quoted: msg });

    setTimeout(async () => {
      try {
        await db.closeDb();
      } catch (err) {
        console.error('Error closing DB during reset:', err);
      }
      console.log('[SYSTEM] Exiting process for restart.');
      process.exit(0);
    }, 2000);
  }
}
