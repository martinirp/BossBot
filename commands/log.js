export default {
  name: 'log',
  aliases: ['logs', 'dano', 'resumo'],
  async execute(context, args) {
    const { sock, remoteJid, msg, withoutPrefix, prefix } = context;
    const cmdLength = withoutPrefix.split(/\s+/)[0].length;
    const logText = withoutPrefix.slice(cmdLength).trim();

    if (!logText) {
      return sock.sendMessage(remoteJid, { text: '⚠️ Envie o log do servidor após o comando. Exemplo:\n' + prefix + 'log 17:58:47 Mr. Punish loses 448 hitpoints...' }, { quoted: msg });
    }

    const events = [];

    // Extrair XP
    const xpRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) gained ([0-9]+) experience points/gi;
    for (const m of logText.matchAll(xpRegex)) {
      let player = m[2].toLowerCase() === 'you' ? 'Você' : m[2].trim();
      events.push({ type: 'xp', index: m.index, ts: m[1], player: player, xp: parseInt(m[3], 10) });
    }

    // Extrair Dano normal
    const dmgRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) loses ([0-9]+) hitpoints due to (?:an|a critical) attack by (.+)\.(?:\s|$)/gi;
    for (const m of logText.matchAll(dmgRegex)) {
      let target = m[2].trim();
      let dmg = parseInt(m[3], 10);
      let attacker = m[4].trim();
      events.push({ type: 'damage', index: m.index, ts: m[1], target: target, dmg: dmg, attacker: attacker });
    }

    // Extrair "Your" damage
    const yourDmgRegex = /(?:([0-9]{2}:[0-9]{2}:[0-9]{2})\s+)?(.+?) loses ([0-9]+) hitpoints due to your (?:critical )?attack\.(?:\s|$)/gi;
    for (const m of logText.matchAll(yourDmgRegex)) {
      let target = m[2].trim();
      let dmg = parseInt(m[3], 10);
      let attacker = 'Você';
      events.push({ type: 'damage', index: m.index, ts: m[1], target: target, dmg: dmg, attacker: attacker });
    }

    // Ordenar eventos pela posição real no texto
    events.sort((a, b) => a.index - b.index);

    const damageDealtTo = {}; 
    const lastHitIndex = {}; // target -> index no array de eventos

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'damage') {
        if (!damageDealtTo[ev.target]) damageDealtTo[ev.target] = {};
        damageDealtTo[ev.target][ev.attacker] = (damageDealtTo[ev.target][ev.attacker] || 0) + ev.dmg;
        lastHitIndex[ev.target] = i; // Armazena a posição do último hit do monstro
      }
    }

    const playersGainingXp = new Set();
    for (const ev of events) {
      if (ev.type === 'xp') {
        playersGainingXp.add(ev.player.toLowerCase());
      }
    }
    playersGainingXp.add('você');
    playersGainingXp.add('you');

    let possibleBosses = [];
    for (const target of Object.keys(damageDealtTo)) {
      if (playersGainingXp.has(target.toLowerCase())) continue; // Exclui players

      let totalDmg = 0;
      for (const atk of Object.keys(damageDealtTo[target])) {
        totalDmg += damageDealtTo[target][atk];
      }
      possibleBosses.push({ name: target, damage: totalDmg });
    }

    possibleBosses.sort((a, b) => b.damage - a.damage);
    let boss = possibleBosses.length > 0 ? possibleBosses[0].name : null;

    if (!boss) {
      return sock.sendMessage(remoteJid, { text: '❌ Não encontrei dados de dano em monstros no log enviado.' }, { quoted: msg });
    }

    // Agora vamos isolar a XP
    let xpBlocks = [];
    let currentBlock = null;

    // Agrupar XP contígua em "blocos"
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'xp') {
        if (!currentBlock) {
          currentBlock = { startIndex: i, endIndex: i, totalXp: 0, gains: {} };
          xpBlocks.push(currentBlock);
        }
        currentBlock.endIndex = i;
        currentBlock.totalXp += ev.xp;
        currentBlock.gains[ev.player] = (currentBlock.gains[ev.player] || 0) + ev.xp;
      } else {
        currentBlock = null; // quebra o bloco se houver outro evento (ex: dano) no meio
      }
    }

    let finalXpGains = {};
    if (boss && lastHitIndex[boss] !== undefined) {
      const bossHitIdx = lastHitIndex[boss];
      
      // Procurar o primeiro bloco de XP que ocorre imediatamente DEPOIS do último hit do boss
      let bestBlock = xpBlocks.find(b => b.startIndex > bossHitIdx);
      
      // Maior bloco de XP do log (para fallback caso a morte não fique perfeitamente alinhada)
      let maxBlock = xpBlocks.length > 0 ? xpBlocks.reduce((prev, curr) => (prev.totalXp > curr.totalXp) ? prev : curr) : null;
      
      // Se achamos um bloco após a morte, e ele não for minúsculo (menos de 10% do pico de XP)
      if (bestBlock && bestBlock.totalXp > (maxBlock ? maxBlock.totalXp * 0.1 : 0)) {
        finalXpGains = bestBlock.gains;
      } else if (maxBlock) {
        finalXpGains = maxBlock.gains;
      }
    } else if (xpBlocks.length > 0) {
      let maxBlock = xpBlocks.reduce((prev, curr) => (prev.totalXp > curr.totalXp) ? prev : curr);
      finalXpGains = maxBlock.gains;
    }

    const bossAttackers = damageDealtTo[boss];
    const totalBossDamage = possibleBosses[0].damage;

    const attackerList = Object.keys(bossAttackers).map(atk => ({
      name: atk,
      damage: bossAttackers[atk],
      percent: ((bossAttackers[atk] / totalBossDamage) * 100).toFixed(1)
    })).sort((a, b) => b.damage - a.damage);

    let bossNameFmt = boss.replace(/^a |^an /i, '');
    bossNameFmt = bossNameFmt.charAt(0).toUpperCase() + bossNameFmt.slice(1);

    let response = `🏆 *Resumo do Combate: ${bossNameFmt}*\n`;
    response += `💀 *Dano Total Recebido:* ${totalBossDamage.toLocaleString('pt-BR')}\n\n`;
    
    response += `⚔️ *Dano Causado:*\n`;
    attackerList.forEach((atk, i) => {
      let rank = i + 1;
      let emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '▪️';
      response += `${emoji} ${atk.name}: ${atk.damage.toLocaleString('pt-BR')} (${atk.percent}%)\n`;
    });

    const xpList = Object.keys(finalXpGains).map(p => ({
      name: p,
      xp: finalXpGains[p]
    })).sort((a, b) => b.xp - a.xp);

    if (xpList.length > 0) {
      response += `\n✨ *XP Recebida (Top 10):*\n`;
      xpList.slice(0, 10).forEach((p, i) => {
        response += `🌟 ${p.name}: ${p.xp.toLocaleString('pt-BR')} XP\n`;
      });
    }

    await sock.sendMessage(remoteJid, { text: response }, { quoted: msg });
  }
};
