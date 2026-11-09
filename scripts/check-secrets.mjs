#!/usr/bin/env node
// CLAUDE.md § 10.3 (A.8.24) / § 10.5 p. 4 — CI-vakt mot hemligheter i repot.
//
// Sveper alla git-spårade filer efter mönster för riktiga nycklar/tokens och
// failar bygget vid träff. Kompletterar (ersätter inte) GitHub secret
// scanning. Platshållare (`xxxx`, `CHANGE_ME`, `<...>`) räknas inte.
// Inga beroenden — körs i `yarn test`.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['privat nyckel', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS-nyckel', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Resend-nyckel', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/],
  ['OpenAI/Anthropic-nyckel', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  [
    'hårdkodad hemlighet i env-fil',
    /^(?:[A-Z0-9_]*(?:SECRET|PASSWORD|API_KEY|TOKEN|PRIVATE_KEY|ENCRYPTION_KEY))=(?!\s*$)(?!.*(?:xxxx|CHANGE_ME|<|your[-_]|example))\S{8,}/m
  ]
];

// Filer som legitimt innehåller mönster (tester av själva detektorerna).
const ALLOW = [/(^|\/)yarn\.lock$/, /\.test\.(?:ts|mjs|js)$/, /^scripts\/check-secrets\.mjs$/];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => !ALLOW.some((re) => re.test(f)));

const hits = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binär
  for (const [label, re] of PATTERNS) {
    // env-mönstret gäller bara env-filer; övriga mönster gäller allt.
    if (label.startsWith('hårdkodad') && !/(^|\/)\.env/.test(file)) continue;
    if (re.test(text)) hits.push(`${file}: ${label}`);
  }
}

if (hits.length) {
  console.error('✗ Möjliga hemligheter i git-spårade filer:\n' + hits.map((h) => `  - ${h}`).join('\n'));
  console.error('Flytta värdet till Coolify-env och rotera nyckeln om den har pushats.');
  process.exit(1);
}
console.log(`✓ Hemlighetsvakt: inga nycklar/tokens i ${files.length} spårade filer`);
