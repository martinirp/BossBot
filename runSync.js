import { initDb } from './database.js';
import { syncKillStatistics } from './syncTibiaData.js';

async function run() {
  try {
    console.log('[CLI-SYNC] Inicializando banco de dados...');
    await initDb();
    console.log('[CLI-SYNC] Iniciando sincronização com TibiaData...');
    await syncKillStatistics();
    console.log('[CLI-SYNC] Sincronização concluída com sucesso!');
    process.exit(0);
  } catch (err) {
    console.error('[CLI-SYNC] Falha fatal na sincronização:', err);
    process.exit(1);
  }
}

run();
