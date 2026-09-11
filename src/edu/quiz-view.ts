/**
 * Quiz "bedside view" (design 2026-09-11, D-019): the instructor's hide set — what the learner cannot see
 * while a quiz runs — and the locked quiz link `#<scenario-id>?quiz=<comma-separated keys | bedside>`.
 * Pure; the controller applies it.
 */

export const QUIZ_HIDE_KEYS = ['truth', 'pes', 'scenario', 'derived', 'explain', 'co2'] as const;
export type QuizHideKey = (typeof QUIZ_HIDE_KEYS)[number];

/** Checkbox tooltips (Instructor panel "Quiz view"). */
export const QUIZ_HIDE_LABELS: Record<QuizHideKey, string> = {
  truth: 'Truth layer, truth badges and truth-only readouts',
  pes: 'Esophageal pressure (Pes row, occlusion-test and shunt tiles)',
  scenario: 'Scenario title, summary, objectives, targets, suggested fix, best score',
  derived: 'Lung-stress dashboard, Validation link, balloon-only tiles',
  explain: 'Explain tab, badge click and badge hover evidence',
  co2: 'CO2 loop panel and time warp',
};

export const QUIZ_BEDSIDE_PRESET = 'bedside';

export function bedsideHide(): Set<QuizHideKey> {
  return new Set(QUIZ_HIDE_KEYS);
}

export interface QuizHashInfo {
  scenarioId: string;
  hide: Set<QuizHideKey>;
  /** True only when the hash carries a `quiz` query (a link the instructor handed out). */
  locked: boolean;
}

function isHideKey(x: string): x is QuizHideKey {
  return (QUIZ_HIDE_KEYS as readonly string[]).includes(x);
}

/** Parse `location.hash` (with or without the leading `#`/`#/`); null when there is no scenario id. */
export function parseQuizHash(hash: string): QuizHashInfo | null {
  const body = hash.replace(/^#\/?/, '');
  const q = body.indexOf('?');
  const scenarioId = q >= 0 ? body.slice(0, q) : body;
  if (!scenarioId) return null;
  const params = new URLSearchParams(q >= 0 ? body.slice(q + 1) : '');
  const quiz = params.get('quiz');
  const hide = new Set<QuizHideKey>();
  if (quiz === QUIZ_BEDSIDE_PRESET) for (const key of QUIZ_HIDE_KEYS) hide.add(key);
  else if (quiz) {
    for (const raw of quiz.split(',')) {
      const key = raw.trim();
      if (isHideKey(key)) hide.add(key);
    }
  }
  return { scenarioId, hide, locked: quiz !== null };
}

/** Locked quiz link for a scenario and hide set; `base` is the page URL (origin + path), '' for a bare hash. */
export function quizLink(scenarioId: string, hide: Iterable<QuizHideKey>, base = ''): string {
  const set = new Set(hide);
  const keys = QUIZ_HIDE_KEYS.filter((key) => set.has(key));
  const value = keys.length === QUIZ_HIDE_KEYS.length ? QUIZ_BEDSIDE_PRESET : keys.join(',');
  return `${base}#${scenarioId}?quiz=${value}`;
}
