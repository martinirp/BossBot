export default {
   name: 'help',
   aliases: ['ajuda'],
   execute: async (context, args) => {
      const { sock, msg, remoteJid, prefix } = context;
      const helpText = `📋 *Comandos do BossBot:*

1. *Menu e Inscrição em Bosses:*
   - \`${prefix}addboss\` ou \`${prefix}adicionarboss\`: Envia a lista de bosses.
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

7. *Histórico e Checagem de Bosses:*
   - \`${prefix}last <boss>\` (Aliases: \`${prefix}historico\`): Exibe o registro da última vez que o boss foi confirmado vivo, mostrando a data, a hora e quem encontrou.
   - \`${prefix}check <boss>\` (Aliases: \`${prefix}checar\`): Foi no respawn e o boss não estava? Use este comando para registrar a hora exata da sua checagem. Isso ajuda outros a saberem que o respawn está limpo recentemente!
   - \`${prefix}lastcheck <boss>\` (Alias: \`${prefix}uc\`): Traz as informações combinadas: mostra a última pessoa que encontrou o boss vivo E também o último registro de quem foi lá checar e achou vazio.

8. *Competição / Ranking:*
   - \`${prefix}rank\` ou \`${prefix}ranking\`: Exibe o Placar de Líderes do mês! Conta quantos bosses cada jogador confirmou no mês atual. O ranking é zerado automaticamente a cada virada de mês.

9. *Administração:*
   - \`${prefix}adm\` ou \`${prefix}admin\`: Lista os comandos de uso gerencial e administração de grupos.

10. *Sistema:*
    - \`${prefix}help\` ou \`${prefix}ajuda\`: Mostra esta lista de comandos.`;

      await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
   }
}
