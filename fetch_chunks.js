import fs from 'fs';

async function run() {
    try {
        const res = await fetch('https://www.exevopan.com/bosses/Quelibra');
        const html = await res.text();
        const matches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)];
        
        for (const match of matches) {
            const url = `https://www.exevopan.com${match[1]}`;
            const scriptRes = await fetch(url);
            const scriptText = await scriptRes.text();
            
            if (scriptText.includes('16~28') || scriptText.includes('The Welter')) {
                console.log('Found in chunk:', url);
                fs.writeFileSync('chunk_with_data.js', scriptText);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
run();
