import dotenv from 'dotenv';
import { enqueueNotification, sendPushoverMessage } from './notifier.js';

dotenv.config();

/**
 * Exemplo de como o bot envia uma mensagem de alerta de Boss.
 * Este script serve apenas como demonstração.
 */
async function rodarExemplo() {
  console.log('--- Iniciando Exemplo de Alerta de Boss ---\n');

  // 1. Dados simulados
  const bossName = 'Ferumbras';
  const extraText = 'Apareceu na Citadel!';
  const world = 'Quelibra';
  
  // Simulando inscritos (números de telefone ou JIDs)
  const subscribers = ['5511999999999@s.whatsapp.net'];

  // Simulando a conexão do WhatsApp (sock) com funções vazias para não dar erro
  const fakeSock = {
    groupMetadata: async (jid) => {
      return {
        id: jid,
        participants: [{ id: '5511999999999@s.whatsapp.net', admin: null }]
      };
    },
    sendMessage: async (jid, content) => {
      console.log(`[WhatsApp Simulado] Enviando mensagem para ${jid}:`);
      console.log(content);
      return {};
    }
  };

  // Como a mensagem é construída internamente no notifier.js:
  const now = new Date();
  now.setHours(now.getHours() - 3);
  const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const alertMessage = extraText 
    ? `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${bossName.toUpperCase()}\n🕒 *Horário:* ${timeString}\n📍 *Detalhes:* ${extraText}`
    : `🚨 *ALERTA DE BOSS* 🚨\n\n⚔️ *Boss:* ${bossName.toUpperCase()}\n🕒 *Horário:* ${timeString}`;

  console.log('=== MENSAGEM CONSTRUÍDA ===');
  console.log(alertMessage);
  console.log('===========================\n');

  console.log('--- Chamando enqueueNotification ---');
  // 2. Chamando a função principal do notifier
  // OBS: Como este é um exemplo, a execução real depende de conexões válidas 
  // com o banco de dados (db.js) e instâncias reais do Baileys (WhatsApp) e Pushover.
  
  try {
    // Descomente a linha abaixo para tentar executar o fluxo do notifier localmente
    // (Pode falhar se o banco de dados não estiver configurado corretamente no ambiente)
    
    // await enqueueNotification(fakeSock, subscribers, bossName, extraText, world);
    console.log('Simulação de chamada finalizada. Para ver a execução real, importe e use a função com instâncias verdadeiras.');
  } catch (error) {
    console.error('Erro ao chamar enqueueNotification:', error);
  }
}

rodarExemplo();
