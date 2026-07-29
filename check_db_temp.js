const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('bossbot.db');
db.all("SELECT created_at FROM boss_reports WHERE reported_by_jid = 'TibiaData_API' LIMIT 5", (err, rows) => {
    console.log('TibiaData_API rows in boss_reports:', rows);
});
db.all("SELECT seen_at FROM boss_last_seen WHERE confirmed_by = 'TibiaData_API' LIMIT 5", (err, rows) => {
    console.log('TibiaData_API rows in boss_last_seen:', rows);
});
