import { syncKillStatistics } from '../syncTibiaData.js';

export default {
  name: 'sync',
  aliases: ['sincronizar', 'atualizar'],
  execute: async (context, args) => {
    const { sock, msg, remoteJid, senderPhone } = context;

    console.log(`[SYSTEM] Manual sync requested by @${senderPhone}.`);

    await sock.sendMessage(remoteJid, {
      text: `🔄 Iniciando sincronização manual com a API do TibiaData...`
    }, { quoted: msg });

    try {
      await syncKillStatistics();
      
      await sock.sendMessage(remoteJid, {
        text: `✅ Sincronização com o TibiaData concluída com sucesso!\n📊 O banco de dados foi atualizado com os últimos registros.`
      }, { quoted: msg });
    } catch (err) {
      console.error('[SYNC-CMD] Erro ao executar sincronização manual:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Falha ao sincronizar com o TibiaData. Verifique os logs do servidor.`
      }, { quoted: msg });
    }
  }
};
