#!/usr/bin/env node
import { basePayload, writeTrace } from './trace-lib.mjs';

writeTrace('plugin-probe-mcp.json', basePayload('mcp'));

function send(message, framed) {
  const json = JSON.stringify(message);
  if (!framed) {
    process.stdout.write(`${json}\n`);
    return;
  }
  const body = Buffer.from(json, 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(body, framed) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object' || message.id === undefined) {
    return;
  }
  if (message.method === 'initialize') {
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    send(
      {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'plugin-probe-canary', version: '0.1.0' },
        },
      },
      framed,
    );
    return;
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [] } }, framed);
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result: {} }, framed);
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    const newline = buffer.indexOf('\n');
    if (headerEnd !== -1 && (newline === -1 || headerEnd < newline)) {
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString('utf8');
      buffer = buffer.slice(start + length);
      handle(body, true);
      continue;
    }
    if (newline === -1) return;
    const line = buffer.slice(0, newline).toString('utf8').trim();
    buffer = buffer.slice(newline + 1);
    if (!line || line.toLowerCase().startsWith('content-length')) continue;
    handle(line, false);
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
