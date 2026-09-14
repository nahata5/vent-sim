/**
 * Detector agreement with the truth labels in the new modes (reported, not gated; D-022).
 *   npx tsx scripts/mode-detector-report.ts
 */
import { runHeadless } from '../src/sim/headless';
import { labelRun, type PatternId } from '../src/sim/truth/labeler';
import { detectRun } from '../src/detector/detector';
import { resolveScenario, scenarioById, scenarioSchedule } from '../src/edu/scenarios';

const IDS = ['simv-low-support', 'simv-mixed-breaths', 'simv-stacking'];
const PATTERNS: PatternId[] = ['ineffective-effort', 'double-trigger', 'flow-starvation', 'auto-peep'];
console.log('| Scenario | Pattern | tp | fp | tn | fn | Sens | Spec |');
console.log('|---|---|---|---|---|---|---|---|');
for (const id of IDS) {
  const def = scenarioById(id);
  const res = runHeadless({ ...resolveScenario(def), duration: 60, schedule: scenarioSchedule(def) });
  const truth = labelRun(res);
  const det = detectRun(res);
  for (const p of PATTERNS) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    for (const tb of truth.breaths) {
      if (tb.tStart < 10) continue;
      const db = det.breaths.find((d) => Math.abs(d.tStart - tb.tStart) < 1e-6);
      const t = tb.patterns.includes(p);
      const d = db?.patterns.includes(p) ?? false;
      if (t && d) tp += 1;
      else if (!t && d) fp += 1;
      else if (!t && !d) tn += 1;
      else fn += 1;
    }
    const sens = tp + fn ? tp / (tp + fn) : NaN;
    const spec = tn + fp ? tn / (tn + fp) : NaN;
    console.log(`| ${id} | ${p} | ${tp} | ${fp} | ${tn} | ${fn} | ${sens.toFixed(2)} | ${spec.toFixed(2)} |`);
  }
}
