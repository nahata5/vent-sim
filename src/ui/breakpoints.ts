import { useEffect, useState } from 'preact/hooks';

/** Widths up to this are the phone layout (theme.css `@media (max-width: 699px)`; design 2026-09-11 §2, D-020). */
export const PHONE_MAX_WIDTH = 699;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
/** Two-column tablet layout; the desktop grid starts at 1100 px. */
export const TABLET_QUERY = `(min-width: ${PHONE_MAX_WIDTH + 1}px) and (max-width: 1099px)`;
/** Coarse pointer: a tap this close to the top of the waveform screen counts as a badge tap (design §3). */
export const BADGE_TAP_HEIGHT = 32;

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Touch devices (media query, with the touch-point count as a fallback for emulators). */
export function isCoarsePointer(): boolean {
  return matches('(pointer: coarse)') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
}

/** True below `PHONE_MAX_WIDTH`; re-renders when the viewport crosses the threshold. */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(() => matches(PHONE_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
