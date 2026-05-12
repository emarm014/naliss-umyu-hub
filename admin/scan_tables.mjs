import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dir = path.join(__dirname, 'src');
const regex = /\.from\(['"`]([\w-]+)['"`]\)/g;
const tables = new Set();

function scanDir(currentDir) {
  const files = fs.readdirSync(currentDir);
  for (const file of files) {
    const fullPath = path.join(currentDir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDir(fullPath);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        tables.add(match[1]);
      }
    }
  }
}

scanDir(dir);
console.log(Array.from(tables).join('\n'));
