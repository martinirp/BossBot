const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('data.sqlite');
db.all("SELECT boss_name, reported_by_jid, created_at FROM boss_reports WHERE boss_name LIKE '%Whopper%'", [], (err, rows) => {
    console.log(rows);
});
