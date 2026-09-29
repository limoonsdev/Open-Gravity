#!/usr/bin/env node
// npm / npx entry point. The single-file bundle is produced by `npm run build`.
const path = require('path');
const fs = require('fs');

const bundle = path.join(__dirname, '..', 'build', 'open-gravity.cjs');
if (!fs.existsSync(bundle)) {
  console.error('Open Gravity is not built yet. Run: npm install && npm run build');
  process.exit(1);
}
require(bundle);
