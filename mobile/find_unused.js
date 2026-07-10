const fs = require('fs');
const path = require('path');

const rootDirs = ['src', 'app', 'components'];
const allFiles = [];

function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walk(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
            allFiles.push(fullPath);
        }
    }
}

rootDirs.forEach(walk);

const allContent = allFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const unusedFiles = [];
for (const file of allFiles) {
    // files in app/ are routing files, they are implicitly used
    if (file.startsWith('app\\') || file.startsWith('app/')) continue;
    
    const basename = path.basename(file, path.extname(file));
    if (basename === 'index') continue;

    // very simple check: does the filename (without extension) appear anywhere in the codebase?
    // this handles both imports and dynamic requires roughly.
    if (!allContent.includes(basename)) {
        unusedFiles.push(file);
    }
}

console.log(JSON.stringify(unusedFiles, null, 2));
