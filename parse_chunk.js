import fs from 'fs';

const text = fs.readFileSync('chunk_with_data.js', 'utf8');

// The chunk probably has something like {name:"The Welter",... days:16,...}
// Let's use a broad regex to extract object-like structures containing name and days

const matches = [...text.matchAll(/name:"([^"]+)",[^}]*days:([0-9]+)[^}]*/g)];

if (matches.length > 0) {
    console.log("Found matches using the days:X pattern:");
    for (const m of matches.slice(0, 5)) {
        console.log(m[0]);
    }
} else {
    // Try looking around 16~28
    const idx = text.indexOf('16~28');
    if (idx !== -1) {
        console.log("Found 16~28 in chunk:");
        console.log(text.substring(Math.max(0, idx - 150), idx + 150));
    } else {
        console.log("Could not find 16~28 or days pattern");
    }
}
