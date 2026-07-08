import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const dir = path.resolve('assets', 'bosses');
const files = fs.readdirSync(dir);

async function convert() {
  for (const file of files) {
    if (file.endsWith('.png') || file.endsWith('.gif') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
      const ext = path.extname(file);
      const basename = path.basename(file, ext);
      const webpPath = path.join(dir, `${basename}.webp`);
      const originalPath = path.join(dir, file);
      
      console.log(`Converting ${file} to ${basename}.webp`);
      try {
        await sharp(originalPath, { animated: true }).webp().toFile(webpPath);
        fs.unlinkSync(originalPath); // remove old file
        console.log(`Successfully converted ${file}`);
      } catch(e) {
        console.error(`Error converting ${file}:`, e);
      }
    }
  }
}

convert();
