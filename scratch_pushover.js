
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.PUSHOVER_TOKEN;
const user = process.env.PUSHOVER_USER_KEY;

if (!token || !user) {
  console.log("Missing token or user");
  process.exit(1);
}

const bodyObj = {
  token,
  user,
  message: 'Teste de Prioridade 2. Não confirme (não dê Acknowledge). Veja se toca de novo em 30s!',
  title: 'BossBot Test',
  priority: 2,
  sound: 'siren',
  retry: 30,
  expire: 3600
};

console.log("Sending:", JSON.stringify(bodyObj, null, 2));

fetch('https://api.pushover.net/1/messages.json', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bodyObj)
})
.then(res => res.json())
.then(json => console.log("Response:", json))
.catch(err => console.error("Error:", err));
