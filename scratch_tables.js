import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('bossbot.db');
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
  console.log("TABLES:", rows);
});
