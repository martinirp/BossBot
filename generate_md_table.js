import fs from 'fs';

const data = JSON.parse(fs.readFileSync('boss_intervals.json', 'utf8'));

let md = `# Tabela de Previsões de Bosses (ExevoPan)

Esta é a extração direta dos intervalos de nascimentos dos bosses usados pelo site ExevoPan. O valor Mínimo e Máximo determinam a janela em que o boss pode nascer.

| Boss | Janela de Nascimento (Dias) | Observação |
|---|---|---|
`;

const sortedNames = Object.keys(data).sort();
for (const name of sortedNames) {
    const stats = data[name];
    if (stats.fixedDaysFrequency) {
        let min = stats.fixedDaysFrequency.min;
        let max = stats.fixedDaysFrequency.max;
        
        // ExevoPan source shows (min) ~ (max), mas na UI eles ajustam para (min+1) ~ (max-1)?
        // Para "The Welter" (15 ~ 29), a UI diz "16~28 days".
        // Isso significa que se min=15, começa a nascer no dia 16.
        // Se max=29, o último dia pra nascer é o 28?
        // Vamos mostrar exatamente o que está na source.
        let minExib = min + 1;
        let maxExib = max - 1;
        
        // Tratar bosses de dia exato (ex: min:1 max:1 -> nasce todo dia)
        if (min === max) {
            md += `| **${name}** | A cada ${min} dia(s) | |\n`;
        } else {
            md += `| **${name}** | ${minExib} ~ ${maxExib} dias | *(Source: ${min} ~ ${max})* |\n`;
        }
    }
}

fs.writeFileSync('C:\\Users\\Lucas\\.gemini\\antigravity-ide\\brain\\ea40ee64-0625-4493-9a07-fe61f9cf7f7e\\exevopan_bosses_table.md', md);
