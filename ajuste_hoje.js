import sqlite3 from 'sqlite3';

const dbFile = 'bossbot.db';
const db = new sqlite3.Database(dbFile);

// Lista de bosses confirmados hoje/ontem
const updates = [
  { boss: 'The Frog Prince', time: '2026-06-20 23:40' },
  { boss: 'Zarabustor', time: '2026-06-20 23:11' },
  { boss: 'The Blightfather', time: '2026-06-20 20:20' },
  { boss: 'Flamecaller Zazrak', time: '2026-06-20 18:00' },
  { boss: 'The Welter', time: '2026-06-20 11:01' },
  { boss: 'Yachal', time: '2026-06-20 10:56' },
  { boss: 'Big Boss Trolliver', time: '2026-06-20 10:29' },
  { boss: 'Captain Jones', time: '2026-06-20 02:32' }
];

console.log("Iniciando injeção do histórico atrasado...");

db.serialize(() => {
  updates.forEach(u => {
    db.run(
      `INSERT INTO boss_last_seen (boss_name, confirmed_by, seen_at) VALUES (?, ?, ?)
       ON CONFLICT(boss_name) DO UPDATE SET confirmed_by = excluded.confirmed_by, seen_at = excluded.seen_at`,
      [u.boss, 'system_adjust', u.time],
      (err) => {
        if (err) console.error(`Erro ao atualizar ${u.boss}:`, err);
        else console.log(`✅ Atualizado: ${u.boss} (${u.time})`);
      }
    );
  });
});

db.close(() => {
  console.log("Finalizado com sucesso! Seu banco de dados agora possui esses registros.");
});
