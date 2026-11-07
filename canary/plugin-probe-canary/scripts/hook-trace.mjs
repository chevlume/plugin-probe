#!/usr/bin/env node
import { basePayload, writeTrace } from './trace-lib.mjs';

const kind = process.argv[2] === 'async' ? 'async' : 'sync';
const filename = kind === 'async' ? 'plugin-probe-hook-async.json' : 'plugin-probe-hook-sync.json';
writeTrace(filename, basePayload(kind));

process.stdin.on('data', () => {});
setTimeout(() => {
  process.exit(0);
}, 30);
