/**
 * Low-end tier: phones/tablets (coarse primary pointer) or devices reporting little
 * memory / few cores. Evaluated once; used to pick cheaper rendering settings.
 */
export const isLowEnd: boolean = (() => {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || (nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4;
})();
