import fs from 'fs';

async function generateTable() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/xandjiji/exevo-pan/master/packages/data-dictionary/src/dictionaries/bossStatistics.ts');
        let tsCode = await res.text();
        
        // Remove TypeScript specific syntax to make it runnable in JS
        tsCode = tsCode.replace(/import type {[^}]+} from '[^']+';?/g, '');
        tsCode = tsCode.replace(/type [A-Za-z]+ = {[^}]+}/g, '');
        tsCode = tsCode.replace(/export const bossStatistics = new Map<[^>]+>\(\)/g, 'const bossStatistics = new Map();');
        tsCode = tsCode.replace(/export { bossStatistics };?/g, '');
        
        // Append logic to export the map to JSON
        tsCode += `
import fs from 'fs';
const data = {};
for (const [key, value] of bossStatistics.entries()) {
    data[key] = value;
}
fs.writeFileSync('boss_intervals.json', JSON.stringify(data, null, 2));
`;

        fs.writeFileSync('temp_bossStatistics.js', tsCode);
        console.log("Wrote temp_bossStatistics.js");
    } catch (e) {
        console.error("Error fetching bossStatistics", e);
    }
}
generateTable();
