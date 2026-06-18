# BossBot 🐲

O BossBot é um bot para WhatsApp focado em gerenciar inscrições e disparar alertas rápidos (inclusive de emergência contínua) sobre o nascimento de bosses no Tibia (ou qualquer outro MMORPG) usando a API do Pushover. 

Este projeto foi construído utilizando Node.js, `baileys` (para a conexão com o WhatsApp via WebSockets) e `sqlite3` para armazenamento persistente dos inscritos, configurações de grupos e histórico.

---

## 🛠️ Requisitos

1. Node.js (v18 ou superior).
2. NPM ou Yarn.
3. Conta no [Pushover](https://pushover.net) para gerenciamento de notificações Push.
4. Um número de WhatsApp válido.

---

## 🚀 Como Iniciar (Setup)

1. Clone este repositório no seu servidor local ou nuvem.
2. Execute `npm install` para baixar as dependências.
3. Configure o arquivo `.env` com base no `.env.example`. Você precisará configurar o Token da sua aplicação do Pushover.
4. Execute `npm start`.
5. Um QR Code será exibido no terminal. Escaneie-o usando o WhatsApp (em Aparelhos Conectados) do número que será o Bot.
6. Pronto! O bot estará ativo.

---

## ⚙️ Variáveis de Ambiente (`.env`)

- `SPAM_COUNT`: Quantidade de mensagens consecutivas de alerta disparadas no grupo do WhatsApp. (Ex: `4`)
- `SPAM_INTERVAL_MS`: Intervalo de tempo entre os spams no grupo. (Ex: `3000` = 3s)
- `SUBSCRIBER_INTERVAL_MS`: Tempo de delay antes de enviar mensagem no privado (DM) para os inscritos.
- `POLL_EXPIRY_SECONDS`: Tempo de duração em segundos da validade das enquetes geradas com `!bosses`.
- `MAX_ALLOWED_GROUPS`: Número máximo de grupos nos quais o bot vai atuar. Para adicionar o grupo, use `!addgroup`.
- `DB_FILE`: Nome do arquivo do banco SQLite (padrão: `bossbot.db`).
- `PUSHOVER_TOKEN`: O token ("API Token/Key") do seu aplicativo criado no Pushover.
- `PUSHOVER_USER_KEY`: Chave de usuário para onde a notificação "global" é enviada (opcional, pode ser substituída ou complementada pelos registros pessoais).
- `PUSHOVER_RETRY`: Tempo de repetição em segundos para alertas de emergência (padrão: `30`).

---

## 📖 Comandos do Bot (WhatsApp)

Estes comandos podem ser chamados apenas nos grupos oficiais permitidos (ou na DM para comandos gerais que não envolvem grupos específicos).

### 👥 Gerenciamento (Admin/Grupo)
- \`!addgroup\`: Vincula o bot ao grupo atual (limitado pelo `MAX_ALLOWED_GROUPS`).
- \`!removegroup\`: Desvincula o bot do grupo atual.
- \`!reset\`: Reinicia o bot pelo próprio WhatsApp.

### 🎮 Inscrições de Bosses
- \`!boss <número ou nome>\`: Inscreve o seu número de WhatsApp para ser notificado sobre aquele boss específico. Você pode passar vários separados por vírgula.
  - _Exemplo: \`!boss 1, 2, 3\` ou \`!boss ferumbras, zomba\`_
- \`!bosses todos\` ou \`!todos\`: Inscreve você em todos os bosses de uma única vez.
- \`!bosses\`: Mostra a imagem do menu com a lista e os números de todos os bosses.
- \`!meusbosses\`: Mostra em quais bosses você está inscrito.
- \`!remover <nome/numero>\` ou \`!limpar <nome/numero>\`: Remove sua inscrição daquele boss específico.
- \`!limparbosses\`: Remove todas as suas inscrições de todos os bosses.

### 🚨 Confirmação de Boss Vivo
- \`!confirmar <boss>\` ou \`!c <boss>\`: Confirma o nascimento do boss e **dispara alertas para todos os inscritos**.
  - Você pode passar um comentário ou localização de brinde usando vírgula ou barra (`|`).
  - _Exemplo: \`!c ferumbras | torre\`_

---

## 🔔 Sistema de Alertas & Pushover

Para não perder nenhum boss durante a madrugada ou em horário de foco, o bot foi integrado com a API do Pushover, que permite alertas customizados ignorando os "modos não perturbe" do seu celular.

### Pushover Pessoal vs Global
- O bot pode notificar chaves globais setadas no `.env` (enviando para a conta dona do bot).
- Mas ele também permite que cada jogador cadastre a sua própria conta Pushover!
  - \`!pushover <sua-chave>\`: Registra sua conta Pushover no banco do bot.
  - \`!pushover remover\`: Deleta seu registro de notificação pessoal.

### Configuração de Nível de Alerta
Você pode controlar o nível das notificações que chegam pelo Pushover (essa configuração muda a configuração **Global** do bot atualmente):

- \`!alert 0\`: **Normal** — Toca o som de notificação apenas 1 vez e respeita o silencioso do celular.
- \`!alert 1\`: **Alta (High)** — Toca 1 vez e fica destacado em vermelho no aplicativo, respeitando as horas de silêncio se configurado.
- \`!alert 2\`: **Emergência** — O som da sirene será emitido e a API continuará insistindo **a cada 30 segundos por até 3 horas** até que você abra o aplicativo Pushover e dê `Acknowledge` (confirme a leitura). **Quebra as regras de silêncio do celular.**

---

### Dica Avançada: Sirene Contínua no Pushover
Se o "Nível 2" não parece contínuo para você (porque ele toca, fica mudo por 30 segundos, e toca de novo), a solução para um alarme ininterrupto de relógio é usar MP3s longos customizados:
1. Pela sua conta no site do Pushover (Dashboard), em "Custom Sounds", faça upload de um MP3 de uma sirene alta com duração de 30s ou 1 minuto.
2. Modifique no código-fonte `notifier.js` o parâmetro `sound: 'siren'` pelo identificador do seu áudio gerado pelo site (ex: `c_meuAudio`).
3. O bot instruirá os celulares a tocarem o MP3 completo, e como há uma renovação do ping a cada 30 segundos, o som rodará num loop ininterrupto!
