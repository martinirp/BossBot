/**
 * Script para baixar GIFs faltando com URLs exatas do tibiawiki.com.br
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import https from 'https';

const ASSETS_DIR = path.resolve('assets', 'bosses');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// URLs exatas verificadas diretamente nas páginas do tibiawiki.com.br via browser
// Nota: Nimmersatt e Yachal não têm sprite no wiki (personagens de lore sem imagem própria)
const MISSING_BOSSES = [
  { name: 'Arachir The Ancient One',   url: 'https://www.tibiawiki.com.br/images/c/c3/Arachir_the_Ancient_One.gif' },
  { name: 'Chizzoron The Distorter',   url: 'https://www.tibiawiki.com.br/images/f/fa/Chizzoron_the_Distorter.gif' },
  { name: 'Cublarc The Plunderer',     url: 'https://www.tibiawiki.com.br/images/5/53/Cublarc_the_Plunderer.gif' },
  { name: 'Diblis The Fair',           url: 'https://www.tibiawiki.com.br/images/0/0f/Diblis_the_Fair.gif' },
  { name: 'Jesse The Wicked',          url: 'https://www.tibiawiki.com.br/images/c/c6/Jesse_the_Wicked.gif' },
  { name: 'Mr Punish',                 url: 'https://www.tibiawiki.com.br/images/3/3f/Mr._Punish.gif' },
  // Nimmersatt: lore-only, sem sprite no wiki - pulado
  { name: 'Robby The Reckless',        url: 'https://www.tibiawiki.com.br/images/d/d7/Robby_the_Reckless.gif' },
  // Yachal: arquivo não existe no wiki - pulado
  { name: 'Yaga The Crone',            url: 'https://www.tibiawiki.com.br/images/2/25/Yaga_the_Crone.gif' },
  { name: 'Zulazza The Corruptor',     url: 'https://www.tibiawiki.com.br/images/b/ba/Zulazza_the_Corruptor.gif' },
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 BossBotAssetDownloader/1.0' }
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(destPath); } catch(e) {}
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch(e) {}
        reject(new Error(`HTTP ${response.statusCode} para ${url}`));
        return;
      }
      const contentType = response.headers['content-type'] || '';
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(contentType); });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch(e) {}
      reject(err);
    });
  });
}

async function main() {
  console.log('=== Baixando GIFs com URLs corretas do tibiawiki.com.br ===\n');
  const results = { success: [], failed: [] };

  for (const { name, url } of MISSING_BOSSES) {
    const tmpGif = path.join(ASSETS_DIR, `${name}.gif`);
    const webpPath = path.join(ASSETS_DIR, `${name}.webp`);

    if (fs.existsSync(webpPath)) {
      console.log(`[SKIP] ${name} — WebP já existe`);
      results.success.push(name);
      continue;
    }

    console.log(`[DOWN] ${name}`);
    console.log(`       ${url}`);

    try {
      const contentType = await downloadFile(url, tmpGif);
      console.log(`       ✅ Baixado (${contentType})`);

      try {
        await sharp(tmpGif, { animated: true }).webp().toFile(webpPath);
      } catch {
        await sharp(tmpGif).webp().toFile(webpPath);
      }
      console.log(`       ✅ Convertido para WebP`);

      await sleep(400);
      try { fs.unlinkSync(tmpGif); console.log(`       🗑️  GIF removido`); }
      catch(e) { console.warn(`       ⚠️  Não removeu GIF: ${e.message}`); }

      results.success.push(name);
    } catch (err) {
      console.error(`       ❌ FALHOU: ${err.message}`);
      results.failed.push({ name, error: err.message });
      await sleep(200);
      try { if (fs.existsSync(tmpGif)) fs.unlinkSync(tmpGif); } catch(e) {}
    }
    console.log('');
  }

  console.log('=== RESULTADO ===');
  console.log(`✅ Sucesso: ${results.success.length}/${MISSING_BOSSES.length}`);
  if (results.failed.length > 0) {
    console.log(`❌ Falhas:`);
    results.failed.forEach(f => console.log(`   - ${f.name}: ${f.error}`));
  }
}

main().catch(console.error);
