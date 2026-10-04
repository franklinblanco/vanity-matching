import { evaluateHardFilters, type Person, type Prefs } from './filters';
import { computeBalance, targetSlateSize, type MarketBalance } from './balance';
import { seededScore } from './rng';
import { haversineKm } from './geo';
import { COMFORT_LOAD, MAX_SLATE_SIZE } from './version';

export interface Participant {
  person: Person;
  prefs: Prefs;
}

export interface SlateEntryReason {
  filtersPassed: string[];
  /** Always true since v4 (mutuality is a hard filter); kept so the reason shape is stable. */
  mutual: boolean;
  score: number;
  /** True when this person was shown before and is back via the meet-again fallback. */
  meetAgain: boolean;
  /** True when this person is beyond the viewer's distance (only filled when in-range runs out). */
  outOfRange: boolean;
}

export interface SlateEntryPlan {
  candidateUserId: number;
  rank: number;
  reason: SlateEntryReason;
}

export interface SlatePlan {
  userId: number;
  size: number;
  entries: SlateEntryPlan[];
}

export interface ComposeResult {
  balance: MarketBalance;
  slates: SlatePlan[];
}

export interface ComposeOptions {
  /** Seed component so ranking is reproducible per round. */
  roundSeed: string | number;
  /** Pairs already shown, as `${viewerId}:${candidateId}` (one-directional). */
  shownPairs: Set<string>;
  /** Pairs that must never meet (blocks), as `${a}:${b}` — checked both ways. */
  blockedPairs?: Set<string>;
  load?: number;
  now?: Date;
}

interface Scored {
  candidateUserId: number;
  reason: SlateEntryReason;
}

/**
 * Pure slate composition for one market's participants. No I/O — the caller persists the
 * result. Pipeline (README): mutual hard filters → soft distance → freshness → seeded score
 * → balanced sizing → capacity-capped assignment.
 */
export function composeSlates(participants: Participant[], opts: ComposeOptions): ComposeResult {
  const load = opts.load ?? COMFORT_LOAD;
  const now = opts.now ?? new Date();
  const blocked = opts.blockedPairs ?? new Set<string>();
  const balance = computeBalance(participants.map((p) => p.person.gender));

  // 1. Each viewer's eligible candidates, best first.
  const ranked = new Map<number, Scored[]>();
  const targets = new Map<number, number>();
  for (const viewer of participants) {
    const scored: Scored[] = [];
    for (const other of participants) {
      const v = viewer.person.userId;
      const o = other.person.userId;
      if (o === v) continue;
      if (blocked.has(`${v}:${o}`) || blocked.has(`${o}:${v}`)) continue;

      const result = evaluateHardFilters(viewer.person, viewer.prefs, other.person, other.prefs, now);
      if (!result.passed) continue;

      // Distance is soft: out-of-range people rank below everyone in range and only fill the
      // slate when there aren't enough nearby.
      const distance = haversineKm(viewer.person.latitude, viewer.person.longitude, other.person.latitude, other.person.longitude);
      const outOfRange = distance > viewer.prefs.maxDistanceKm;
      const filtersPassed = outOfRange ? result.filtersPassed : [...result.filtersPassed, 'distance'];
      const meetAgain = opts.shownPairs.has(`${v}:${o}`);
      const score = seededScore(`${opts.roundSeed}:${v}:${o}`);
      scored.push({ candidateUserId: o, reason: { filtersPassed, mutual: true, score, meetAgain, outOfRange } });
    }
    // In-range first, then fresh, then by descending reproducible score.
    scored.sort((a, b) => {
      if (a.reason.outOfRange !== b.reason.outOfRange) return a.reason.outOfRange ? 1 : -1;
      if (a.reason.meetAgain !== b.reason.meetAgain) return a.reason.meetAgain ? 1 : -1;
      return b.reason.score - a.reason.score;
    });
    ranked.set(viewer.person.userId, scored);
    targets.set(viewer.person.userId, Math.min(MAX_SLATE_SIZE, targetSlateSize(viewer.person.gender, balance, load)));
  }

  // 2. Capacity-capped assignment (MECHANICS.md §1): nobody appears on more than L slates.
  // Round-robin by slate position — everyone gets their first pick before anyone gets a
  // second — in a seeded viewer order, so popular people's capacity is shared fairly.
  const inbound = new Map<number, number>();
  const chosen = new Map<number, Scored[]>(participants.map((p) => [p.person.userId, []]));
  const cursor = new Map<number, number>(participants.map((p) => [p.person.userId, 0]));
  const order = participants
    .map((p) => p.person.userId)
    .sort((a, b) => seededScore(`${opts.roundSeed}:order:${a}`) - seededScore(`${opts.roundSeed}:order:${b}`));

  for (let position = 0; position < MAX_SLATE_SIZE; position += 1) {
    for (const v of order) {
      const picks = chosen.get(v)!;
      if (picks.length >= targets.get(v)! || picks.length > position) continue;
      const list = ranked.get(v)!;
      let i = cursor.get(v)!;
      while (i < list.length && (inbound.get(list[i]!.candidateUserId) ?? 0) >= load) i += 1;
      if (i < list.length) {
        const pick = list[i]!;
        picks.push(pick);
        inbound.set(pick.candidateUserId, (inbound.get(pick.candidateUserId) ?? 0) + 1);
        i += 1;
      }
      cursor.set(v, i);
    }
  }

  const slates: SlatePlan[] = participants.map((p) => {
    const picks = chosen.get(p.person.userId)!;
    return {
      userId: p.person.userId,
      size: picks.length,
      entries: picks.map((s, idx) => ({ candidateUserId: s.candidateUserId, rank: idx + 1, reason: s.reason })),
    };
  });
  return { balance, slates };
}
