import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getAllBossesLastSeen, setBossLastSeenDate, getUniqueWorlds, setGlobalSetting, getGlobalSetting, revertBossLastSeen, getBossLastSeen, getAllowedGroups, getGroupWorld, addBossReport } from './database.js';
import { sendGroupMessage } from './whatsapp.js';

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

function isGermanDST(date) {
  const year = date.getUTCFullYear();

  // Último domingo de março (DST começa às 02:00 CET = 01:00 UTC)
  const marchEnd = new Date(Date.UTC(year, 2, 31));
  while (marchEnd.getUTCDay() !== 0) marchEnd.setUTCDate(marchEnd.getUTCDate() - 1);
  const dstStart = new Date(Date.UTC(year, 2, marchEnd.getUTCDate(), 1, 0, 0));

  // Último domingo de outubro (DST termina às 03:00 CEST = 01:00 UTC)
  const octEnd = new Date(Date.UTC(year, 9, 31));
  while (octEnd.getUTCDay() !== 0) octEnd.setUTCDate(octEnd.getUTCDate() - 1);
  const dstEnd = new Date(Date.UTC(year, 9, octEnd.getUTCDate(), 1, 0, 0));

  return date >= dstStart && date < dstEnd;
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

        // Calcula e salva o checksum do dia para o comando !boss comparar mais tarde
        let currentSum = 0;
        entries.forEach(e => { currentSum += e.last_day_killed; });
        await setGlobalSetting(`tibiadata_checksum_${targetWorld}`, currentSum);

        if (entries.length === 0) {
            console.log(`[SYNC] TibiaData API retornou 0 criaturas para o mundo ${targetWorld}. Sincronização abortada.`);
            return;
        }

        const killedYesterday = entries.filter(e => e.last_day_killed > 0);
        const allLocal = await getAllBossesLastSeen(targetWorld);

        // Converte hora atual para BRT (UTC-3)
        const brtNow = new Date();
        brtNow.setUTCHours(brtNow.getUTCHours() - 3);
        const brtHour = brtNow.getUTCHours();

        // Determina se a Alemanha está em DST (Horário de Verão: UTC+2) ou Padrão (CET: UTC+1)
        const utcNow = new Date();
        const isDST = isGermanDST(utcNow);
        const offsetHours = isDST ? 2 : 1;

        // Calcula a hora atual na Alemanha (CET/CEST)
        const germanTime = new Date(utcNow.getTime() + offsetHours * 60 * 60 * 1000);

        // Subtrai 10 horas para obter a data do ciclo de Server Save correspondente
        const trackingTime = new Date(germanTime.getTime() - 10 * 60 * 60 * 1000);

        // O TibiaData atualiza Kill Statistics uma vez por dia (~22:15 / ~23:15 BRT).
        // Se a sincronização roda à noite (após as 21:00 BRT), a API já virou e traz os dados do ciclo anterior (daysAgo = 1).
        // Se roda no dia seguinte de manhã/tarde (antes das 21:00 BRT), a API traz os dados de 2 ciclos atrás (daysAgo = 2).
        const daysAgo = brtHour >= 21 ? 1 : 2;

        const targetDate = new Date(trackingTime.getTime());
        targetDate.setUTCDate(targetDate.getUTCDate() - daysAgo);
        
        const year = targetDate.getUTCFullYear();
        const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getUTCDate()).padStart(2, '0');
        
        // Registra como 00:00 do dia D: a API informa apenas a DATA do ciclo, não a hora exata.
        const fallbackDate = `${year}-${month}-${day} 00:00`;
        const fallbackDayStr = `${year}-${month}-${day}`;

        // ─── DETECÇÃO E REVERSÃO DE FALSOS ALARMES ───
        const killedBossNames = new Set(killedYesterday.map(k => k.race.toLowerCase()));
        const apiKnownRaces = new Set(entries.map(e => e.race.toLowerCase()));
        
        function getBaseBossName(fullName) {
            const match = fullName.match(/^(.+?)\s*\(/);
            return match ? match[1].trim() : fullName.trim();
        }

        function getActualKillCalendarDate(seenAtStr) {
            const [trackingDateStr, brtTimeStr] = seenAtStr.split(' ');
            const [brtHour, brtMin] = brtTimeStr.split(':').map(Number);
            
            const [tYear, tMonth, tDay] = trackingDateStr.split('-').map(Number);
            const utcDate = new Date(Date.UTC(tYear, tMonth - 1, tDay, brtHour + 3, brtMin));
            const isDST = isGermanDST(utcDate);
            
            const serverSaveBrtHour = isDST ? 5 : 6;
            const pad = (n) => String(n).padStart(2, '0');
            
            if (brtHour < serverSaveBrtHour) {
                const nextDay = new Date(Date.UTC(tYear, tMonth - 1, tDay + 1));
                return `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}`;
            } else {
                return trackingDateStr;
            }
        }

        for (const localRecord of allLocal) {
            const confirmedByHuman = localRecord.confirmed_by !== 'TibiaData_API' && 
                                     localRecord.confirmed_by !== 'system_adjust' && 
                                     localRecord.confirmed_by !== 'flop';
            
            if (!confirmedByHuman) continue;

            const actualKillDayStr = getActualKillCalendarDate(localRecord.seen_at);
            if (actualKillDayStr === fallbackDayStr) {
                const baseName = getBaseBossName(localRecord.boss_name).toLowerCase();
                
                // Só acusa falso alarme se a criatura existe no relatório da API e consta com 0 mortes.
                // Isso evita reverter falsos alarmes para bosses que não são listados na página de Kill Statistics (ex: Dire Penguin).
                if (apiKnownRaces.has(baseName) && !killedBossNames.has(baseName)) {
                    console.log(`[SYNC-WARN] Falso alarme detectado em ${targetWorld}: ${localRecord.boss_name} por ${localRecord.confirmed_by}. Revertendo...`);
                    
                    // Reverter o boss no banco
                    await revertBossLastSeen(localRecord.boss_name, targetWorld);
                    
                    // Notificar grupos
                    const restoredRecord = await getBossLastSeen(localRecord.boss_name, targetWorld);
                    let restoredInfo = 'Sem registros anteriores.';
                    const mentions = [localRecord.confirmed_by];
                    
                    if (restoredRecord) {
                        const [rDate, rTime] = restoredRecord.seen_at.split(' ');
                        const [rYear, rMonth, rDay] = rDate.split('-');
                        const rPhone = restoredRecord.confirmed_by.split('@')[0];
                        restoredInfo = `${rDay}/${rMonth}/${rYear} às ${rTime} (Confirmado por: @${rPhone})`;
                        if (restoredRecord.confirmed_by.includes('@')) {
                            mentions.push(restoredRecord.confirmed_by);
                        }
                    }

                    const userPhone = localRecord.confirmed_by.split('@')[0];
                    const warningText = `⚠️ *ALERTA FALSO DETECTADO!*\n\n` +
                                        `O boss *${localRecord.boss_name.toUpperCase()}* foi reportado ontem por @${userPhone}, mas as estatísticas oficiais da CipSoft (TibiaData) indicam que ele *não morreu*.\n\n` +
                                        `↩️ A última aparição dele foi revertida para:\n📅 *${restoredInfo}*\n\n` +
                                        `⚠️ *Atenção:* Evitem confirmar bosses sem certeza para não comprometer os tempos e previsões!`;
                    
                    const allowedGroups = await getAllowedGroups();
                    for (const groupJid of allowedGroups) {
                        const groupWorld = await getGroupWorld(groupJid);
                        if (groupWorld === targetWorld) {
                            await sendGroupMessage(groupJid, warningText, mentions);
                        }
                    }
                }
            }
        }
        // ─────────────────────────────────────────────

        // Busca o estado local mais atualizado após possíveis reversões
        const allLocalAfterRevert = await getAllBossesLastSeen(targetWorld);
        const localMap = {};
        allLocalAfterRevert.forEach(r => {
            localMap[r.boss_name.toLowerCase()] = { seen_at: r.seen_at, confirmed_by: r.confirmed_by };
        });

        let syncCount = 0;

        for (const kill of killedYesterday) {
            const bossName = kill.race;
            
            // Pula se não for um boss mapeado (para não cadastrar "rat", "dragon", etc)
            if (!validBosses.includes(bossName.toLowerCase())) {
                continue;
            }

            const localRecord = localMap[bossName.toLowerCase()];
            
            let needsUpdate = false;

            if (!localRecord) {
                needsUpdate = true; // Bot nunca viu esse boss
            } else {
                // PROTEÇÃO: jamais sobrescrever registro confirmado por um usuário real com dado da API.
                // A API só substitui registros que ela mesma criou anteriormente (TibiaData_API / system_adjust).
                const confirmedByApi = localRecord.confirmed_by === 'TibiaData_API' || localRecord.confirmed_by === 'system_adjust';

                if (confirmedByApi) {
                    const localDayStr = localRecord.seen_at.split(' ')[0]; // Ex: 2026-06-15
                    // Se o registro da API é mais antigo do que a nova data da API, atualiza.
                    if (localDayStr < fallbackDayStr) {
                        needsUpdate = true;
                    }
                } else {
                    // Registro confirmado por humano: API nunca sobrescreve.
                    console.log(`[SYNC] ${targetWorld}: ${bossName} confirmado por usuário (${localRecord.confirmed_by}), ignorando dado da API.`);
                }
            }

            if (needsUpdate) {
                console.log(`[SYNC] Boss perdido em ${targetWorld}: ${bossName}. Registrando morte em: ${fallbackDate}`);
                const finalBossName = bossName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

                await setBossLastSeenDate(finalBossName, 'TibiaData_API', fallbackDate, targetWorld);
                await addBossReport(finalBossName, 'Detectado via TibiaData API', 'TibiaData_API', 0, targetWorld);
                syncCount++;
            }
        }
        console.log(`[SYNC] Sincronização de ${targetWorld} finalizada. ${syncCount} bosses recuperados.`);
    } catch (err) {
        console.error(`[SYNC] Falha na sincronização do mundo ${targetWorld}:`, err);
    }
}

// Verifica se a API do TibiaData atualizou e executa a sincronização completa
export async function checkAndSyncIfApiUpdated() {
    try {
        const worlds = await getUniqueWorlds();
        const defaultWorld = process.env.TIBIA_WORLD || 'Quelibra';
        const targetWorld = worlds.length > 0 ? worlds[0] : defaultWorld;

        // Converte para BRT (UTC-3) para formatar a data de hoje
        const brtNow = new Date();
        brtNow.setUTCHours(brtNow.getUTCHours() - 3);
        const pad = (n) => String(n).padStart(2, '0');
        const todayStr = `${brtNow.getUTCFullYear()}-${pad(brtNow.getUTCMonth() + 1)}-${pad(brtNow.getUTCDate())}`;

        // Verifica se já sincronizou hoje
        const lastSync = await getGlobalSetting('tibiadata_last_sync_date');
        if (lastSync === todayStr) {
            console.log(`[SYNC-CHECK] Já sincronizado hoje (${todayStr}). Pulando verificação.`);
            return;
        }

        console.log(`[SYNC-CHECK] Verificando se a API do TibiaData atualizou para ${targetWorld}...`);
        
        const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${targetWorld}`);
        if (!res.ok) {
            console.error(`[SYNC-CHECK] Falha ao verificar API do TibiaData (Status: ${res.status})`);
            return;
        }
        
        const data = await res.json();
        const entries = data.killstatistics?.entries || [];
        let currentSum = 0;
        entries.forEach(e => { currentSum += e.last_day_killed; });

        const savedSumStr = await getGlobalSetting(`tibiadata_checksum_${targetWorld}`);
        
        if (savedSumStr === null) {
            // Primeiro registro: inicializa o checksum e encerra
            await setGlobalSetting(`tibiadata_checksum_${targetWorld}`, currentSum);
            console.log(`[SYNC-CHECK] Checksum inicializado para ${targetWorld}: ${currentSum}`);
            return;
        }

        const savedSum = parseInt(savedSumStr, 10);

        if (currentSum !== savedSum) {
            console.log(`[SYNC-CHECK] Mudança de checksum detectada (${savedSum} -> ${currentSum}). A API atualizou!`);
            
            // Executa a sincronização completa
            await syncKillStatistics();
            
            // Grava que sincronizou hoje para evitar re-runs
            await setGlobalSetting('tibiadata_last_sync_date', todayStr);
            console.log(`[SYNC-CHECK] Sincronização automatizada concluída para ${todayStr}.`);
        } else {
            console.log(`[SYNC-CHECK] A API ainda não atualizou hoje (Checksum estável: ${currentSum}).`);
        }
    } catch (err) {
        console.error('[SYNC-CHECK] Erro ao verificar atualização da API:', err);
    }
}

// Inicia os crons inteligente e de fallback
export function startSyncCron() {
    // 1. Cron Inteligente: roda a cada 15 min nas horas da noite (21:00 às 03:00)
    cron.schedule('*/15 21,22,23,0,1,2,3 * * *', () => {
        checkAndSyncIfApiUpdated();
    });

    // 2. Cron de Fallback: roda às 06:00 AM como garantia
    cron.schedule('0 6 * * *', () => {
        syncKillStatistics();
    });

    console.log('[SYNC] Cron Jobs de sincronização inteligente e fallback agendados.');
}
