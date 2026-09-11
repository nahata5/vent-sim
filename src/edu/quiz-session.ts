/**
 * Quiz session state machine (Spec §8): idle → identify → identified → fix → done. Times are simulated
 * seconds (the fix window is 60 s of simulation regardless of the playback speed); setting changes are
 * counted by the controller and passed in.
 */
import { k } from '../config/constants';
import type { PatternId } from '../sim/truth/labeler';
import { gradeFix, gradeIdentification, quizScore, type FixGrade, type FixInput, type IdentificationGrade } from './quiz';
import type { QuizAttempt } from './progress';

export type QuizPhase = 'idle' | 'identify' | 'identified' | 'fix' | 'done';

export interface QuizResult {
  fix: FixGrade;
  seconds: number;
  changes: number;
  score: number;
  attempt: QuizAttempt;
}

export class QuizSession {
  phase: QuizPhase = 'idle';
  tStart = 0;
  fixWindowStart = 0;
  private changesAtFixStart = 0;
  identification: IdentificationGrade | null = null;
  result: QuizResult | null = null;

  start(tSim: number): void {
    this.phase = 'identify';
    this.tStart = tSim;
    this.identification = null;
    this.result = null;
  }

  submitIdentification(picks: PatternId[], truth: PatternId[]): IdentificationGrade {
    this.identification = gradeIdentification(picks, truth);
    this.phase = 'identified';
    return this.identification;
  }

  startFix(tSim: number, changesSoFar: number): void {
    this.phase = 'fix';
    this.fixWindowStart = tSim;
    this.changesAtFixStart = changesSoFar;
  }

  fixWindowReady(tSim: number): boolean {
    return this.phase === 'fix' && tSim - this.fixWindowStart >= k('QUIZ_FIX_WINDOW') - 1e-9;
  }

  evaluate(tSim: number, inp: FixInput, changesNow: number): QuizResult {
    const fix = gradeFix(inp);
    const seconds = Math.max(0, tSim - this.fixWindowStart);
    const changes = Math.max(0, changesNow - this.changesAtFixStart);
    const identification = this.identification?.score ?? 0;
    const score = quizScore({ identification, fixPassed: fix.pass, seconds, changes });
    this.result = { fix, seconds, changes, score, attempt: { score, identification, fixPassed: fix.pass, seconds, changes, at: Date.now() } };
    this.phase = 'done';
    return this.result;
  }

  reset(): void {
    this.phase = 'idle';
    this.identification = null;
    this.result = null;
  }
}
