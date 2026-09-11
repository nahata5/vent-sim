/**
 * Regenerate the constants table in docs/MODEL.md between the markers from src/config/constants.ts.
 *   npx tsx scripts/model-constants.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { listConstants } from '../src/config/constants';

const START = '<!-- constants:start -->';
const END = '<!-- constants:end -->';
const path = 'docs/MODEL.md';
const doc = readFileSync(path, 'utf8');
const a = doc.indexOf(START);
const b = doc.indexOf(END);
if (a < 0 || b < 0) throw new Error('markers not found in docs/MODEL.md');
const rows = listConstants().map((c) => {
  const value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value);
  const source = c.source.replace(/\|/g, '\\|');
  return `| \`${c.key}\` | ${value} | ${c.unit.replace(/\|/g, '\\|')} | ${c.confidence} | ${source} |`;
});
const table = [
  '',
  `Generated from \`src/config/constants.ts\` (${rows.length} constants). Confidence: V = verified against a primary source, L = literature not re-verified, M = modelling assumption.`,
  '',
  '| Key | Value | Unit | Conf. | Source |',
  '|---|---|---|---|---|',
  ...rows,
  '',
].join('\n');
writeFileSync(path, doc.slice(0, a + START.length) + '\n' + table + doc.slice(b));
console.log(`wrote ${rows.length} constants into ${path}`);
