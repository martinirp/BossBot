import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getAllBossesLastSeen, setBossLastSeenDate } from './database.js';

dotenv.config();

const world = process.env.TIBIA_WORLD || 'Quelibra';

// Carrega a lista oficial de bosses para não cadastrar monstros normais
const validBossesRaw = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
const validBosses = validBossesRaw.map(b => b.toLowerCase());

export async function syncKillStatistics() {
    console.log(`[SYNC] Iniciando sincronização com TibiaData para o mundo: ${world}`);
    try {
        const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${world}`);
        if (!res.ok) {
            throw new Error(`Erro HTTP: ${res.status}`);
        }
        const data = await res.json();
        const entries = data.killstatistics?.entries || [];

        // Filtra apenas os que morreram no dia anterior
        const killedYesterday = entries.filter(e => e.last_day_killed > 0);

        if (killedYesterday.length === 0) {
            console.log('[SYNC] Nenhum boss reportado no dia anterior pelo TibiaData.');
            return;
        }

        const allLocal = await getAllBossesLastSeen();
        const localMap = {};
        allLocal.forEach(r => {
            localMap[r.boss_name.toLowerCase()] = r.seen_at;
        });

        // O killstatistics reflete as mortes de *ontem*.
        // Vamos registrar essas perdas de boss como "Ontem às 12:00".
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, '0');
        const day = String(yesterday.getDate()).padStart(2, '0');
        
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
                console.log(`[SYNC] ⚠️ Equipe perdeu o boss: ${bossName}. Sincronizando do site para: ${fallbackDate}`);
                // Procura o nome original exato na lista (já que kill.race pode ter capitalização zoada, 
                // mas a tabela salva como a string original, ex: "The Frog Prince"). 
                // No entanto, get/set são sensíveis a maiúsculas no BD. Precisamos arrumar a capitalização.
                const originalName = Object.keys(localMap).find(k => k === bossName.toLowerCase()) || bossName;
                
                // Para não cagar o BD caso o boss não exista no localMap, faremos um capitalizer simples se não tiver
                let finalBossName = bossName;
                if (!localMap[bossName.toLowerCase()]) {
                   finalBossName = bossName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                } else {
                   // Achar o nome exato case-sensitive dos cadastros locais não dá pelo localMap (tudo lowercase chave).
                   // Vamos deixar o DB inserir como finalBossName e o !previsao faz lower.
                   finalBossName = bossName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                }

                await setBossLastSeenDate(finalBossName, 'TibiaData_API', fallbackDate);
                syncCount++;
            }
        }
        console.log(`[SYNC] Sincronização finalizada. ${syncCount} bosses recuperados.`);
    } catch (err) {
        console.error('[SYNC] Falha na sincronização:', err);
    }
}

// Inicia o cron para rodar todos os dias às 06:30 da manhã
export function startSyncCron() {
    cron.schedule('30 6 * * *', () => {
        syncKillStatistics();
    });
    console.log('[SYNC] Cron Job de sincronização com TibiaData agendado para as 06:30 diariamente.');
}
