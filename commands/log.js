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

    const lines = logText.split('\n');
    const damageDealtTo = {}; 
    const xpGainedBy = {}; 

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // XP
      let m = line.match(/(?:[0-9]{2}:[0-9]{2}:[0-9]{2}\s+)?(.+?) gained ([0-9]+) experience points/i);
      if (m) {
        let player = m[1].toLowerCase() === 'you' ? 'Você' : m[1];
        let xp = parseInt(m[2], 10);
        xpGainedBy[player] = (xpGainedBy[player] || 0) + xp;
        continue;
      }
      
      // Damage
      m = line.match(/(?:[0-9]{2}:[0-9]{2}:[0-9]{2}\s+)?(.+?) loses ([0-9]+) hitpoints due to (?:an|a critical) attack by (.+?)\./i);
      if (m) {
        let target = m[1];
        let dmg = parseInt(m[2], 10);
        let attacker = m[3];
        if (!damageDealtTo[target]) damageDealtTo[target] = {};
        damageDealtTo[target][attacker] = (damageDealtTo[target][attacker] || 0) + dmg;
        continue;
      }

      // Your damage
      m = line.match(/(?:[0-9]{2}:[0-9]{2}:[0-9]{2}\s+)?(.+?) loses ([0-9]+) hitpoints due to your (?:critical )?attack\./i);
      if (m) {
        let target = m[1];
        let dmg = parseInt(m[2], 10);
        let attacker = 'Você';
        if (!damageDealtTo[target]) damageDealtTo[target] = {};
        damageDealtTo[target][attacker] = (damageDealtTo[target][attacker] || 0) + dmg;
        continue;
      }
    }

    const playersGainingXp = new Set(Object.keys(xpGainedBy).map(x => x.toLowerCase()));
    playersGainingXp.add('você');
    playersGainingXp.add('you');

    let possibleBosses = [];
    for (const target of Object.keys(damageDealtTo)) {
      if (playersGainingXp.has(target.toLowerCase())) continue;

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

    const xpList = Object.keys(xpGainedBy).map(p => ({
      name: p,
      xp: xpGainedBy[p]
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
