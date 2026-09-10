/**
 * Rohrer resistance: ΔP = K1·Q + K2·Q·|Q|  (Brief 1 §1.1).
 */

export function rohrerDrop(k1: number, k2: number, q: number): number {
  return k1 * q + k2 * q * Math.abs(q);
}

/** d(ΔP)/dQ for Newton iterations. */
export function rohrerSlope(k1: number, k2: number, q: number): number {
  return k1 + 2 * k2 * Math.abs(q);
}

/**
 * Closed-form flow for a given pressure drop:
 * Q = sign(ΔP)·(−K1 + √(K1² + 4·K2·|ΔP|)) / (2·K2)   (Brief 1 §1.1)
 */
export function rohrerFlow(k1: number, k2: number, dp: number): number {
  if (dp === 0) return 0;
  if (k2 <= 0) return k1 > 0 ? dp / k1 : 0;
  const mag = (-k1 + Math.sqrt(k1 * k1 + 4 * k2 * Math.abs(dp))) / (2 * k2);
  return Math.sign(dp) * mag;
}
