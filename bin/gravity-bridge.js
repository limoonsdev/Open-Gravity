#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const distPath = path.join(__dirname, '..', 'dist', 'index.js');
if (fs.existsSync(distPath)) {
  require(distPath);
} else {
  // If not compiled yet, use ts-node
  require('ts-node/register');
  require('../src/index.ts');
}
