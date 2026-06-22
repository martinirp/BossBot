import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getAllBossesLastSeen, setBossLastSeenDate, getUniqueWorlds } from './database.js';

dotenv.config();

const world = process.env.TIBIA_WORLD || 'Quelibra';

// Carrega a lista oficial de bosses para não cadastrar monstros normais
const validBossesRaw = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
const validBosses = validBossesRaw.map(b => b.toLowerCase());

export async function syncKillStatistics() {
    console.log(`[SYNC] Iniciando sincronização multimundos com TibiaData...`);
    try {
        const worlds = await getUniqueWorlds();
        
        // Se nenhum grupo estiver cadastrado ainda, sincroniza pelo menos o mundo padrão do .env
        const defaultWorld = process.env.TIBIA_WORLD || 'Quelibra';
        const worldsToSync = worlds.length > 0 ? worlds : [defaultWorld];
        
        for (const targetWorld of worldsToSync) {
            await syncWorldKillStatistics(targetWorld);
        }
        console.log(`[SYNC] Sincronização multimundos finalizada.`);
    } catch (err) {
        console.error('[SYNC] Falha geral na sincronização multimundos:', err);
    }
}

export async function syncWorldKillStatistics(targetWorld) {
    console.log(`[SYNC] Sincronizando mundo: ${targetWorld}`);
    try {
        const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${targetWorld}`);
        if (!res.ok) {
            throw new Error(`Erro HTTP ao buscar ${targetWorld}: ${res.status}`);
        }
        const data = await res.json();
        const entries = data.killstatistics?.entries || [];

        // Filtra apenas os que morreram no dia anterior
        const killedYesterday = entries.filter(e => e.last_day_killed > 0);

        if (killedYesterday.length === 0) {
            console.log(`[SYNC] Nenhum boss reportado no dia anterior pelo TibiaData para ${targetWorld}.`);
            return;
        }

        const allLocal = await getAllBossesLastSeen(targetWorld);
        const localMap = {};
        allLocal.forEach(r => {
            localMap[r.boss_name.toLowerCase()] = r.seen_at;
        });

        // O killstatistics reflete as mortes do "dia anterior" do servidor.
        // Se a sincronização rodar ANTES do Server Save do dia atual (06:00 BRT),
        // a API ainda estará exibindo os dados de 2 dias atrás.
        // Se rodar DEPOIS, exibirá os dados de ontem (1 dia atrás).
        const now = new Date();
        const nowBrHour = (now.getUTCHours() - 3 + 24) % 24;
        let daysAgo = 1;
        if (nowBrHour < 6) {
            daysAgo = 2;
        }

        const targetDate = new Date();
        targetDate.setHours(targetDate.getHours() - 3); // Ajusta para hora de Brasília
        targetDate.setDate(targetDate.getDate() - daysAgo);
        
        const year = targetDate.getUTCFullYear();
        const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getUTCDate()).padStart(2, '0');
        
        const fallbackDate = `${year}-${month}-${day} 12:00`;
        const fallbackDayStr = `${year}-${month}-${day}`;

        let syncCount = 0;

        for (const kill of killedYesterday) {
            const bossName = kill.race;
            
            // Pula se não for um boss mapeado (para não cadastrar "rat", "dragon", etc)
            if (!validBosses.includes(bossName.toLowerCase())) {
                continue;
            }

            const localSeen = localMap[bossName.toLowerCase()];
            
            let needsUpdate = false;

            if (!localSeen) {
                needsUpdate = true; // Bot nunca viu esse boss
            } else {
                const localDayStr = localSeen.split(' ')[0]; // Ex: 2026-06-15
                
                // Se a data que a nossa equipe matou for ANTES da data que o TibiaData está avisando que morreu,
                // significa que eles mataram ontem, mas nós só temos registro do mês passado/semana passada!
                if (localDayStr < fallbackDayStr) {
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                console.log(`[SYNC] ⚠️ Equipe perdeu o boss em ${targetWorld}: ${bossName}. Sincronizando para: ${fallbackDate}`);
                const finalBossName = bossName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

                await setBossLastSeenDate(finalBossName, 'TibiaData_API', fallbackDate, targetWorld);
                syncCount++;
            }
        }
        console.log(`[SYNC] Sincronização de ${targetWorld} finalizada. ${syncCount} bosses recuperados.`);
    } catch (err) {
        console.error(`[SYNC] Falha na sincronização do mundo ${targetWorld}:`, err);
    }
}

// Inicia o cron para rodar todos os dias às 06:30 da manhã
export function startSyncCron() {
    cron.schedule('30 6 * * *', () => {
        syncKillStatistics();
    });
    console.log('[SYNC] Cron Job de sincronização com TibiaData agendado para as 06:30 diariamente.');
}
