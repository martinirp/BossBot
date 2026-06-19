export default {
   name: 'help',
   aliases: ['ajuda'],
   execute: async (context, args) => {
      const { sock, msg, remoteJid, prefix } = context;
      const helpText = `📋 *Comandos do BossBot:*

1. *Menu e Inscrição em Bosses:*
   - \`${prefix}addboss\` ou \`${prefix}adicionarboss\`: Envia a foto com a lista de bosses.
   - \`${prefix}addboss <número/nome>\`: Inscreve você para receber alertas do boss.
     _Exemplo: \`${prefix}addboss 1, 2, 3\` ou \`${prefix}adicionarboss ferumbras, zomba\`_
   - \`${prefix}addall\` ou \`${prefix}todos\`: Inscreve você em TODOS os bosses.

2. *Remover Inscrição:*
   - \`${prefix}delboss <nome/número>\` (Aliases: \`${prefix}remover\`, \`${prefix}limpar\`): Cancela sua inscrição.

3. *Listar Minhas Inscrições:*
   - \`${prefix}list\` ou \`${prefix}meusbosses\`: Mostra todos os bosses nos quais você está inscrito.

4. *Limpar Todas as Inscrições:*
   - \`${prefix}delall\` (Aliases: \`${prefix}limparbosses\`, \`${prefix}clear\`): Cancela todas as suas inscrições de uma vez.

5. *Confirmar Boss Vivo / Alerta:*
   - \`${prefix}confirm <nome do boss>\` (Aliases: \`${prefix}c\`, \`${prefix}confirmar\`, \`${prefix}boss\`): Confirma que o boss nasceu e alerta os inscritos por mensagem e Pushover.
   - Você pode adicionar detalhes de localização após uma vírgula ou barra vertical.
     _Exemplo: \`${prefix}boss ferumbras | perto da escada\` ou \`${prefix}c morgaroth, trap\`_

6. *Notificações Push (Pushover):*
   - \`${prefix}pushover <chave>\`: Cadastra seu User Key pessoal.
   - \`${prefix}pushover remover\`: Remove seu User Key.
   - \`${prefix}test\` ou \`${prefix}teste\`: Envia uma notificação de teste para o seu Pushover.

7. *Comandos de Grupo:*
   - \`${prefix}addgroup\`: Habilita o bot neste grupo.
   - \`${prefix}removegroup\`: Desabilita o bot neste grupo.
   - \`${prefix}groupid\` ou \`${prefix}idgrupo\`: Exibe o ID do grupo atual.

8. *Sistema:*
   - \`${prefix}help\` ou \`${prefix}ajuda\`: Mostra esta lista de comandos.
   - \`${prefix}reset\`: Reinicia o bot.`;

      await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
   }
}
