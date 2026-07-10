const fs = require('fs');
const content = fs.readFileSync('c:/Users/emarm/Desktop/naliss/mobile/src/components/ProtectedRoute.tsx', 'utf8');
const lines = content.split('\n');

const lifecycleBlock = lines.slice(317, 574).join('\n');
const guardBlock = lines.slice(760, 874).join('\n');

const markdown = `# Authentication Route Guard Audit\n\n### 1. The Route Protector Component\n\`\`\`tsx\n${guardBlock}\n\`\`\`\n\n### 2. The Auth Storage Lifecycle\n\`\`\`tsx\n${lifecycleBlock}\n\`\`\``;

fs.writeFileSync('C:/Users/emarm/.gemini/antigravity-ide/brain/70c89e11-23dd-4aed-a019-ff452ee144b5/auth_guard_audit.md', markdown, 'utf8');
console.log('Audit generated');
