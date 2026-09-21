#!/usr/bin/env node
const input = process.argv[2] ?? '';
if (!input) process.exit(0);

let parsed;
try {
  parsed = new URL(input);
} catch {
  process.exit(0);
}

const seen = new Set();
const candidates = [];
const add = (value) => {
  if (!value || seen.has(value)) return;
  seen.add(value);
  candidates.push(value);
};

add(parsed.origin);
add(`${parsed.protocol}//${parsed.host}`);
if (parsed.port === '8000') {
  add(`https://${parsed.hostname}`);
  add(`http://${parsed.hostname}`);
}

for (const candidate of candidates) {
  process.stdout.write(`${candidate}\n`);
}
