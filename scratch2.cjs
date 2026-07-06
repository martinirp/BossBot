const logText = `17:57:27 Danone Volpe loses 260 hitpoints due to an attack by Mr. Punish.
17:58:49 Mr. Punish loses 472 hitpoints due to an attack by Pequena Bob.
17:58:50 Mr. Punish loses 1190 hitpoints due to an attack by Good Druidka.
17:58:50 Claimh gained 11625 experience points.
17:58:50 Murielsziinha gained 7687 experience points.
17:59:00 Rat loses 20 hitpoints due to an attack by Claimh.
17:59:00 Claimh gained 100 experience points.`;

const events = [];

const dmgRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) loses ([0-9]+) hitpoints due to (?:an|a critical) attack by (.+?)\.(?:\s|$)/gi;
for (const m of logText.matchAll(dmgRegex)) {
    events.push({ type: 'damage', index: m.index, ts: m[1], target: m[2].trim(), dmg: parseInt(m[3], 10), attacker: m[4].trim() });
}

const yourDmgRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) loses ([0-9]+) hitpoints due to your (?:critical )?attack\.(?:\s|$)/gi;
for (const m of logText.matchAll(yourDmgRegex)) {
    events.push({ type: 'damage', index: m.index, ts: m[1], target: m[2].trim(), dmg: parseInt(m[3], 10), attacker: 'Você' });
}

const xpRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) gained ([0-9]+) experience points/gi;
for (const m of logText.matchAll(xpRegex)) {
    let player = m[2].toLowerCase() === 'you' ? 'Você' : m[2].trim();
    events.push({ type: 'xp', index: m.index, ts: m[1], player: player, xp: parseInt(m[3], 10) });
}

events.sort((a, b) => a.index - b.index);

const damageDealtTo = {};
const lastHitIndex = {}; // target -> index in events array

for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'damage') {
        if (!damageDealtTo[ev.target]) damageDealtTo[ev.target] = {};
        damageDealtTo[ev.target][ev.attacker] = (damageDealtTo[ev.target][ev.attacker] || 0) + ev.dmg;
        lastHitIndex[ev.target] = i;
    }
}

// Find boss
let possibleBosses = [];
for (const target of Object.keys(damageDealtTo)) {
    let totalDmg = 0;
    for (const atk of Object.keys(damageDealtTo[target])) {
        totalDmg += damageDealtTo[target][atk];
    }
    possibleBosses.push({ name: target, damage: totalDmg });
}
possibleBosses.sort((a, b) => b.damage - a.damage);
let boss = possibleBosses.length > 0 ? possibleBosses[0].name : null;

// Group XP into blocks
let xpBlocks = [];
let currentBlock = null;

for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'xp') {
        // Se mudou o timestamp ou é um evento não-XP no meio (index pulou)
        // Precisamos agrupar XP que acontece junta
        if (!currentBlock) {
            currentBlock = { startIndex: i, endIndex: i, totalXp: 0, gains: {} };
            xpBlocks.push(currentBlock);
        }
        currentBlock.endIndex = i;
        currentBlock.totalXp += ev.xp;
        currentBlock.gains[ev.player] = (currentBlock.gains[ev.player] || 0) + ev.xp;
    } else {
        currentBlock = null;
    }
}

let finalXpGains = {};
if (boss && lastHitIndex[boss] !== undefined) {
    const bossHitIdx = lastHitIndex[boss];
    // Achar o primeiro bloco de XP que ocorre DEPOIS ou no mesmo index (não, XP é um evento depois)
    // Na verdade, o bloco de XP começa logo após o hit.
    let bestBlock = xpBlocks.find(b => b.startIndex > bossHitIdx);
    
    // Se achou um bloco, vamos usar ele. Mas e se for muito pequeno? 
    // Como segurança, pegamos o bloco com o maior totalXp do log inteiro caso o bloco achado seja ridículo
    let maxBlock = xpBlocks.length > 0 ? xpBlocks.reduce((prev, curr) => (prev.totalXp > curr.totalXp) ? prev : curr) : null;
    
    if (bestBlock && bestBlock.totalXp > (maxBlock ? maxBlock.totalXp * 0.1 : 0)) {
        finalXpGains = bestBlock.gains;
    } else if (maxBlock) {
        finalXpGains = maxBlock.gains;
    }
} else if (xpBlocks.length > 0) {
    let maxBlock = xpBlocks.reduce((prev, curr) => (prev.totalXp > curr.totalXp) ? prev : curr);
    finalXpGains = maxBlock.gains;
}

console.log('Boss:', boss);
console.log('XP Gains for Boss:', finalXpGains);
