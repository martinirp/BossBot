export default {
   name: 'adm',
   aliases: ['admin', 'administração', 'gerencial'],
   execute: async (context, args) => {
      const { sock, msg, remoteJid, prefix } = context;
      const admText = `🛡️ *Comandos Gerenciais / Administração:*

1. *Gerenciamento de Grupos:*
   - \`${prefix}addgroup\`: Habilita o bot a funcionar neste grupo.
   - \`${prefix}removegroup\`: Desabilita o bot neste grupo.
   - \`${prefix}groupid\` ou \`${prefix}idgrupo\`: Exibe o ID interno do grupo atual (útil para configurações manuais).
   - \`${prefix}setworld <NomeDoMundo>\` (Aliases: \`${prefix}definirmundo\`, \`${prefix}mundo\`): Configura qual mundo do Tibia este grupo rastreia.

2. *Inscrições Forçadas:*
   - \`${prefix}forceaddboss <nome do boss>\`: Força a inscrição de *todos* os membros do grupo atual em um boss específico. Ideal para garantir que a guilda inteira receba o alerta. (Apenas em grupos).

3. *Sistema:*
   - \`${prefix}reset\`: Reinicia o sistema do bot. (Uso restrito/Cuidado).
`;

      await sock.sendMessage(remoteJid, { text: admText }, { quoted: msg });
   }
}
