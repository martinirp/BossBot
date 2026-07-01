import fs from 'fs';

async function run() {
    try {
        const res = await fetch('https://www.exevopan.com/bosses/Quelibra');
        const text = await res.text();
        const match = text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
        if (match) {
            const data = JSON.parse(match[1]);
            fs.writeFileSync('exevopan_data.json', JSON.stringify(data.props.pageProps, null, 2));
            console.log("Success: wrote exevopan_data.json");
        } else {
            console.log("Failed to find NEXT_DATA script");
        }
    } catch (e) {
        console.error(e);
    }
}
run();
