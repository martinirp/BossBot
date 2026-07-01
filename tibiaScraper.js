import { isGermanDST, formatDateStr } from './database.js';

/**
 * Faz o fetch das estatísticas de kill usando a API do TibiaData.
 * Retorna os dados e a data civil alemã a qual essas estatísticas se referem.
 */
export async function fetchKillStatistics(targetWorld) {
    const res = await fetch(`https://api.tibiadata.com/v4/killstatistics/${targetWorld}`);
    if (!res.ok) {
        throw new Error(`Erro HTTP ao buscar ${targetWorld}: ${res.status}`);
    }
    const data = await res.json();
    const entries = data.killstatistics?.entries || [];

    // Calcula a data alemã referente a essas estatísticas.
    // As estatísticas da CipSoft geralmente são processadas na madrugada alemã (~03:00 CEST/CET).
    // Kills do "dia anterior" são exibidas.
    const utcNow = new Date();
    const isDST = isGermanDST(utcNow);
    const offsetHours = isDST ? 2 : 1;

    // Calcula a hora atual na Alemanha (CET/CEST)
    const germanTime = new Date(utcNow.getTime() + offsetHours * 60 * 60 * 1000);
    const germanHour = germanTime.getUTCHours();
    const statsDate = new Date(germanTime.getTime());

    // Se a hora alemã atual for >= 3, as estatísticas de hoje já foram processadas 
    // e referem-se ao dia de ontem (D-1).
    // Se for < 3, a API ainda está exibindo dados gerados na madrugada de ontem (D-2).
    const daysAgo = germanHour >= 3 ? 1 : 2;
    statsDate.setUTCDate(statsDate.getUTCDate() - daysAgo);

    const pad = (n) => String(n).padStart(2, '0');
    const year = statsDate.getUTCFullYear();
    const month = pad(statsDate.getUTCMonth() + 1);
    const day = pad(statsDate.getUTCDate());
    const statsDateStr = `${year}-${month}-${day}`;

    return {
        entries,
        statsDateStr
    };
}
