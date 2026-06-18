import { spawn } from 'child_process';

function startBot() {
  console.log('-----------------------------------------');
  console.log('[MANAGER] Iniciando o BossBot...');
  console.log('-----------------------------------------');
  
  const botProcess = spawn('node', ['index.js'], {
    stdio: 'inherit',
    shell: true
  });

  botProcess.on('close', (code) => {
    console.log(`\n[MANAGER] O BossBot foi finalizado com o código de saída ${code}.`);
    console.log('[MANAGER] Reiniciando em 3 segundos...\n');
    setTimeout(startBot, 3000);
  });
}

startBot();
