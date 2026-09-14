/**
 * Regenerate docs/SCENARIO_AUTHORING.md from src/edu/authoring.ts.
 *   npx tsx scripts/authoring-doc.ts
 */
import { writeFileSync } from 'node:fs';
import { authoringDocument } from '../src/edu/authoring';

writeFileSync('docs/SCENARIO_AUTHORING.md', authoringDocument());
console.log('wrote docs/SCENARIO_AUTHORING.md');
