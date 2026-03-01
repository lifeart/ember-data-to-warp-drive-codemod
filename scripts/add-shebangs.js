#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const shebang = '#!/usr/bin/env node\n';
const files = ['dist/src/cli.js', 'dist/src/post-check.js'];

for (const file of files) {
  const filePath = path.resolve(__dirname, '..', file);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.startsWith('#!')) {
    fs.writeFileSync(filePath, shebang + content);
    console.log(`Added shebang to ${file}`);
  }
}
