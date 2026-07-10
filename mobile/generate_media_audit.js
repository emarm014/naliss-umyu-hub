const fs = require('fs');

const uploadFile = fs.readFileSync('c:/Users/emarm/Desktop/naliss/mobile/src/lib/cloudinary.ts', 'utf8');
const uploadLines = uploadFile.split('\n');
const uploadHookBlock = uploadLines.slice(174, 321).join('\n');

const downloadFile = fs.readFileSync('c:/Users/emarm/Desktop/naliss/mobile/src/utils/unifiedDownload.ts', 'utf8');
const downloadLines = downloadFile.split('\n');
const downloadHookBlock = downloadLines.slice(58, 363).join('\n');

const markdown = `# Media Upload & Download Pipeline Audit\n\n### 1. The Compression & Upload Hook\n*Located in \`mobile/src/lib/cloudinary.ts\` (Chat Media Upload)*\n\`\`\`typescript\n${uploadHookBlock}\n\`\`\`\n\n### 2. The Local Media Pipeline\n*Located in \`mobile/src/utils/unifiedDownload.ts\`*\n\`\`\`typescript\n${downloadHookBlock}\n\`\`\``;

fs.writeFileSync('C:/Users/emarm/.gemini/antigravity-ide/brain/70c89e11-23dd-4aed-a019-ff452ee144b5/media_pipeline_audit.md', markdown, 'utf8');
console.log('Audit generated');
