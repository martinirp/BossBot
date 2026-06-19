export default {
   name: 'help',
   aliases: ['ajuda'],
   execute: async (context, args) => {
      const { sock, msg, remoteJid, prefix } = context;
      const helpText = `📋 *Comandos do BossBot:*

1. *Menu e Inscrição em Bosses:*
   - \`${prefix}addboss\` ou \`${prefix}adicionarboss\`: Envia a foto com a lista de bosses.
   - \`${prefix}addboss <número ou nome>\`: Inscreve você para receber alertas do boss.
     _Exemplo: \`${prefix}addboss 1, 2, 3\` ou \`${prefix}addboss ferumbras, zomba\`_
   - \`${prefix}addall\` ou \`${prefix}todos\`: Inscreve você em TODOS os bosses.

2. *Remover Inscrição:*
   - \`${prefix}delboss <nome/número>\` ou \`${prefix}remover <nome/número>\`: Cancela sua inscrição.

3. *Listar Minhas Inscrições:*
   - \`${prefix}list\` ou \`${prefix}meusbosses\`: Mostra todos os bosses nos quais você está inscrito.

4. *Limpar Todas as Inscrições:*
   - \`${prefix}delall\` ou \`${prefix}limparbosses\`: Cancela todas as suas inscrições de uma vez.

5. *Confirmar Boss Vivo / Alerta:*
   - \`${prefix}confirm <nome do boss>\` ou \`${prefix}boss <nome do boss>\`: Confirma que o boss nasceu e alerta os inscritos por mensagem e Pushover.
   - Você pode adicionar detalhes de localização após uma vírgula ou barra vertical.
     _Exemplo: \`${prefix}c ferumbras | perto da escada\`_

6. *Notificações Push (Pushover):*
   - \`${prefix}pushover <chave>\`: Cadastra seu User Key pessoal.
   - \`${prefix}pushover remover\`: Remove seu User Key.
   - \`${prefix}test\`: Envia uma notificação de teste para o seu Pushover.

7. *Ajuda:*
   - \`${prefix}help\` ou \`${prefix}ajuda\`: Mostra esta lista de comandos.`;

      await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
   }
}
