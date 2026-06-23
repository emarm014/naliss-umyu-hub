const fs = require('fs');
const file = 'admin/src/pages/EventPoolManagementPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace dark: followed by letters, numbers, hyphens, slashes, and colons.
content = content.replace(/dark:[a-zA-Z0-9\-\/:]+/g, '');

// Clean up double spaces created by the removal
content = content.replace(/  +/g, ' ');

// Clean up leading spaces inside className quotes
content = content.replace(/className=" /g, 'className="');

// Wait, the previous replace(/\s+/g, ' ') would have collapsed newlines! Good thing it failed.
fs.writeFileSync(file, content);
console.log('Fixed dark classes');
