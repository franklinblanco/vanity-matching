/**
 * Deterministic [0, 1) score from a seed string (FNV-1a → mulberry32). Used to
 * rank candidates reproducibly: the same (round, user, candidate) always yields
 * the same score, so the ranking is auditable rather than secret.
 */
export function seededScore(seed: string): number {
  // FNV-1a 32-bit hash of the seed.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mulberry32 step on the hash.
  let t = (h >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
