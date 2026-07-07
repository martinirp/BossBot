const fs = require('fs');
const content = fs.readFileSync('C:/Users/Lucas/Desktop/exevo-pan/apps/exevo-pan/src/modules/BossHunting/bossInfo.ts', 'utf8');

const bosses = [
  'rotworm queen', 'the voice of ruin', 'flamecaller zazrak', 
  'tyrn', 'dreadmaw', 'white pale', 'hirintror', 
  'battlemaster zunzu', 'fleabringer', 'albino dragon'
];

bosses.forEach(b => {
  const safeName = b.replace(/ /g, '\\s+');
  const regex = new RegExp("bossInfo\\.set\\('" + safeName + "',\\s*{[\\s\\S]*?}\\)", 'i');
  const match = content.match(regex);
  if (match) {
    const locs = match[0].match(/description:\s*'([^']+)'/g);
    console.log(b, ':', locs ? locs.map(l => l.replace(/description:\s*'/, '').slice(0, -1)) : 'No locations');
  } else {
    console.log(b, 'not found');
  }
});
