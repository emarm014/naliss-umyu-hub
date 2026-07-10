const fs = require('fs');

const output = fs.readFileSync('tsc_output.txt', 'utf16le');

// TS6133 is the code for unused local/parameter
const lines = output.split('\n').map(l => l.trim());
const unusedErrors = lines.filter(line => line.includes("error TS6133: '") && line.includes("' is declared but its value is never read."));

const toRemove = {};

for (const error of unusedErrors) {
    // Format: app/(tabs)/_layout.tsx(3,10): error TS6133: 'Platform' is declared but its value is never read.
    const match = error.match(/^(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is declared but its value is never read/);
    if (match) {
        const file = match[1];
        const line = parseInt(match[2], 10);
        const name = match[4];
        
        if (!toRemove[file]) toRemove[file] = [];
        toRemove[file].push({ line, name });
    } else {
        console.log("Failed to match:", error);
    }
}

console.log("Files to fix:", Object.keys(toRemove).length);

let filesFixed = 0;

for (const file of Object.keys(toRemove)) {
    if (!fs.existsSync(file)) {
        console.log("File not found:", file);
        continue;
    }
    
    let content = fs.readFileSync(file, 'utf8');
    const fileLines = content.split('\n');
    let modified = false;
    
    // Process from bottom up so line numbers don't shift
    const errors = toRemove[file].sort((a, b) => b.line - a.line);
    
    for (const { line, name } of errors) {
        const lineIndex = line - 1;
        let lineContent = fileLines[lineIndex];
        if (lineContent === undefined) continue;
        
        // Simple heuristic: if it's an import, try to remove just the name or the whole line
        if (lineContent.includes('import ')) {
            // "import Name from ..."
            if (lineContent.match(new RegExp(`import\\s+${name}\\s+from`))) {
                fileLines.splice(lineIndex, 1);
                modified = true;
                continue;
            }
            
            // "import { Name } from ..." or "import { Other, Name } from ..."
            if (lineContent.includes('{') && lineContent.includes(name)) {
                // Remove name and possible trailing/leading comma
                let newLine = lineContent.replace(new RegExp(`\\b${name}\\b\\s*,?`), '');
                newLine = newLine.replace(/,\s*}/, ' }'); // cleanup dangling comma before }
                newLine = newLine.replace(/{\s*,/, '{ '); // cleanup dangling comma after {
                
                // If it became `import { } from '...'` or `import {} from '...'`, remove line
                if (newLine.match(/import\s*{\s*}\s*from/)) {
                    fileLines.splice(lineIndex, 1);
                } else {
                    fileLines[lineIndex] = newLine;
                }
                modified = true;
                continue;
            }
        }
        
        // If it's a const/let unused variable, let's try to remove it if it's a simple declaration
        // e.g. const width = Dimensions.get('window').width;
        if (lineContent.match(new RegExp(`(?:const|let)\\s+${name}\\s*=`))) {
            fileLines.splice(lineIndex, 1);
            modified = true;
        }
    }
    
    if (modified) {
        fs.writeFileSync(file, fileLines.join('\n'));
        filesFixed++;
        console.log('Fixed', file);
    }
}

console.log('Fixed imports in', filesFixed, 'files.');
