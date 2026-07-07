import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
    getAllBossesLastSeen,
    setBossLastSeenDate,
    getUniqueWorlds,
    setGlobalSetting,
    getGlobalSetting,
    addBossReport,
    parseDateStr,
    utcToGerman,
    germanToUtc,
    getBossLastSeen,
    setTibiadataSeenAt
} from './database.js';

dotenv.config();

// Carrega a lista oficial de bosses para não cadastrar monstros normais
const validBossesRaw = JSON.parse(fs.readFileSync(path.resolve('bosses.json'), 'utf8'));
const validBosses = validBossesRaw.map(b => b.toLowerCase());

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna a string "YYYY-MM-DD" do dia atual no horário alemão (CET/CEST).
 * Usado como chave única de controle para evitar sincronizações duplas.
 */
function getGermanTodayStr() {
    const germanNow = utcToGerman(new Date());
    const pad = (n) => String(n).padStart(2, '0');
    return `${germanNow.getUTCFullYear()}-${pad(germanNow.getUTCMonth() + 1)}-${pad(germanNow.getUTCDate())}`;
}

// ─── Sync principal ───────────────────────────────────────────────────────────

export async function syncKillStatistics() {
    console.log(`[SYNC] Iniciando sincronização multimundos com TibiaData...`);
    try {
        const worlds = await getUniqueWorlds();
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

        // Salva o checksum do momento para o próximo ciclo poder comparar
        let currentSum = 0;
        entries.forEach(e => { currentSum += e.last_day_killed; });
        await setGlobalSetting(`tibiadata_checksum_${targetWorld}`, currentSum);

        if (entries.length === 0) {
            console.log(`[SYNC] TibiaData API retornou 0 criaturas para ${targetWorld}. Abortando.`);
            return;
        }

        // Filtra apenas o que foi morto no último ciclo da API (last_day_killed > 0)
        const killedYesterday = entries.filter(e => e.last_day_killed > 0);

        const germanTime = utcToGerman(new Date());
        const germanHour = germanTime.getUTCHours();
        const statsDate = new Date(germanTime.getTime());

        // As estatísticas da CipSoft atualizam diariamente por volta das 22:00–23:00 BRT
        // (= 01:00–02:00 UTC = 03:00 CET/CEST).
        // Se a hora alemã >= 3h, a API já atualizou hoje → exibe kills de D-1.
        // Se a hora alemã < 3h, a API ainda exibe D-2.
        const daysAgo = germanHour >= 3 ? 1 : 2;
        statsDate.setUTCDate(statsDate.getUTCDate() - daysAgo);

        const pad = (n) => String(n).padStart(2, '0');
        const fallbackDayStr = `${statsDate.getUTCFullYear()}-${pad(statsDate.getUTCMonth() + 1)}-${pad(statsDate.getUTCDate())}`;
        const fallbackDate = `${fallbackDayStr} 00:00`;

        // Mapa local atual (pós-reversões — não há mais reversões, mas mantém o padrão)
        const allLocal = await getAllBossesLastSeen(targetWorld);
        const localMap = {};
        allLocal.forEach(r => {
            localMap[r.boss_name.toLowerCase()] = { seen_at: r.seen_at, confirmed_by: r.confirmed_by };
        });

        let syncCount = 0;

        for (const kill of killedYesterday) {
            const bossName = kill.race;

            // Ignora monstros comuns — só processa bosses mapeados em bosses.json
            if (!validBosses.includes(bossName.toLowerCase())) continue;

            const localRecord = localMap[bossName.toLowerCase()];
            let needsUpdate = false;

            if (!localRecord) {
                // Bot nunca viu esse boss — registra via API
                needsUpdate = true;
            } else {
                // PROTEÇÃO: registro humano NUNCA é sobrescrito pela API.
                // A API só atualiza registros que ela mesma criou.
                const confirmedByApi =
                    localRecord.confirmed_by === 'TibiaData_API' ||
                    localRecord.confirmed_by === 'system_adjust';

                if (confirmedByApi) {
                    const localDayStr = localRecord.seen_at.split(' ')[0];
                    if (localDayStr < fallbackDayStr) {
                        needsUpdate = true;
                    }
                } else {
                    console.log(`[SYNC] ${targetWorld}: ${bossName} confirmado pelo grupo (${localRecord.confirmed_by}), ignorando dado da API.`);
                }
            }

            const finalBossName = bossName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            
            const { MULTI_CITY_BOSSES } = await import('./commands.js');
            const cities = MULTI_CITY_BOSSES[finalBossName.toLowerCase()];
            const variants = cities ? cities.map(c => `${finalBossName} (${c})`) : [finalBossName];

            for (const variant of variants) {
                const vLocalRecord = await getBossLastSeen(variant, targetWorld);
                
                let vNeedsUpdate = false;
                if (!vLocalRecord) {
                    vNeedsUpdate = true;
                } else {
                    const confirmedByApi =
                        vLocalRecord.confirmed_by === 'TibiaData_API' ||
                        vLocalRecord.confirmed_by === 'system_adjust';

                    if (confirmedByApi) {
                        const localDayStr = vLocalRecord.seen_at.split(' ')[0];
                        if (localDayStr < fallbackDayStr) {
                            vNeedsUpdate = true;
                        }
                    }
                }

                if (vNeedsUpdate) {
                    console.log(`[SYNC] ${targetWorld}: ${variant} não estava no banco — registrando via API em ${fallbackDate}`);
                    await setBossLastSeenDate(variant, 'TibiaData_API', fallbackDate, targetWorld);

                    const fallbackDateGerman = parseDateStr(fallbackDate);
                    const fallbackDateUtc = germanToUtc(fallbackDateGerman);
                    const fallbackDateUtcStr = fallbackDateUtc.toISOString().replace('T', ' ').substring(0, 19);
                    await addBossReport(variant, 'Detectado via TibiaData API', 'TibiaData_API', 0, targetWorld, fallbackDateUtcStr);
                    syncCount++;
                } else {
                    await setTibiadataSeenAt(variant, targetWorld, fallbackDate);
                }
            }
        }

        console.log(`[SYNC] ${targetWorld} concluído. ${syncCount} boss(es) recuperados da API.`);
    } catch (err) {
        console.error(`[SYNC] Falha na sincronização de ${targetWorld}:`, err);
    }
}

// ─── Detecção de atualização da API ──────────────────────────────────────────

/**
 * Verifica se o checksum da API mudou em qualquer mundo.
 * Se sim, executa a sincronização completa (uma única vez por dia alemão).
 *
 * O lock é gravado ANTES da sync para evitar execuções duplas caso o cron
 * dispare novamente enquanto a sync ainda estiver rodando.
 */
export async function checkAndSyncIfApiUpdated() {
    try {
        const worlds = await getUniqueWorlds();
        const defaultWorld = process.env.TIBIA_WORLD || 'Quelibra';
        const worldsToCheck = worlds.length > 0 ? worlds : [defaultWorld];

        const todayStr = getGermanTodayStr();

        // Guard: não sincroniza mais de uma vez por dia (horário alemão)
        const lastSync = await getGlobalSetting('tibiadata_last_sync_date');
        if (lastSync === todayStr) {
            console.log(`[SYNC-CHECK] Já sincronizado hoje (${todayStr}). Pulando.`);
            return;
        }

        let apiUpdated = false;

        for (const targetWorld of worldsToCheck) {
            const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${targetWorld}`);
            if (!res.ok) {
                console.error(`[SYNC-CHECK] Erro ao verificar ${targetWorld}: HTTP ${res.status}`);
                continue;
            }

            const data = await res.json();
            const entries = data.killstatistics?.entries || [];
            let currentSum = 0;
            entries.forEach(e => { currentSum += e.last_day_killed; });

            const savedSumStr = await getGlobalSetting(`tibiadata_checksum_${targetWorld}`);

            if (savedSumStr === null) {
                await setGlobalSetting(`tibiadata_checksum_${targetWorld}`, currentSum);
                console.log(`[SYNC-CHECK] Checksum inicializado para ${targetWorld}: ${currentSum}`);
                continue;
            }

            const savedSum = parseInt(savedSumStr, 10);

            if (currentSum !== savedSum) {
                console.log(`[SYNC-CHECK] ${targetWorld}: checksum mudou (${savedSum} → ${currentSum}). API atualizou!`);
                apiUpdated = true;
                break;
            } else {
                console.log(`[SYNC-CHECK] ${targetWorld}: checksum estável (${currentSum}). API ainda não atualizou.`);
            }
        }

        if (apiUpdated) {
            // Grava o lock ANTES de rodar a sync — evita disparo duplo se o cron
            // voltar a rodar enquanto syncKillStatistics() ainda está em execução.
            await setGlobalSetting('tibiadata_last_sync_date', todayStr);
            console.log(`[SYNC-CHECK] Lock gravado para ${todayStr}. Iniciando sync completa...`);
            await syncKillStatistics();
            console.log(`[SYNC-CHECK] Sync completa concluída para ${todayStr}.`);
        }
    } catch (err) {
        console.error('[SYNC-CHECK] Erro:', err);
    }
}

// ─── Cron Job ─────────────────────────────────────────────────────────────────

export function startSyncCron() {
    // A TibiaData API atualiza entre 22:00 e 00:00 BRT (= 01:00–03:00 UTC),
    // dependendo do horário de verão alemão (CEST/CET).
    // Verifica a cada 5 minutos nessa janela. Quando detectar mudança de checksum,
    // sincroniza uma única vez (o lock impede execuções duplicadas).
    cron.schedule('*/5 1,2,3 * * *', () => {
        checkAndSyncIfApiUpdated();
    });

    console.log('[SYNC] Cron agendado: verificação a cada 5 min entre 01:00–03:59 UTC (22:00–00:59 BRT).');
}
