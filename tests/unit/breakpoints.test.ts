import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_MAX_WIDTH, PHONE_QUERY, TABLET_QUERY } from '../../src/ui/breakpoints';

/** The phone threshold lives in TS (usePhoneLayout) and in CSS (theme.css); they must not drift (design 2026-09-11 §2). */
describe('layout breakpoints', () => {
  const css = readFileSync(new URL('../../src/ui/theme.css', import.meta.url), 'utf8');
  it('theme.css uses the phone query that usePhoneLayout uses', () => {
    expect(PHONE_QUERY).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    expect(css).toContain(`@media ${PHONE_QUERY}`);
  });
  it('the tablet query starts where the phone query ends and stops below the desktop grid', () => {
    expect(TABLET_QUERY).toBe(`(min-width: ${PHONE_MAX_WIDTH + 1}px) and (max-width: 1099px)`);
    expect(css).toContain(`@media ${TABLET_QUERY}`);
    expect(css).not.toContain('@media (max-width: 1100px)');
  });
});
