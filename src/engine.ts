import { evaluateHardFilters, isMutual, type Person, type Prefs } from './filters';
import { computeBalance, targetSlateSize, type MarketBalance } from './balance';
import { seededScore } from './rng';
import { haversineKm } from './geo';
import { COMFORT_LOAD } from './version';

export interface Participant {
  person: Person;
  prefs: Prefs;
}

export interface SlateEntryReason {
  filtersPassed: string[];
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
  load?: number;
  now?: Date;
}

/**
 * Pure slate composition for one market's participants. No I/O — the caller
 * persists the result. Implements the pipeline in this module's README.
 */
export function composeSlates(participants: Participant[], opts: ComposeOptions): ComposeResult {
  const load = opts.load ?? COMFORT_LOAD;
  const now = opts.now ?? new Date();
  const balance = computeBalance(participants.map((p) => p.person.gender));

  const slates: SlatePlan[] = participants.map((viewer) => {
    const scored: { candidateUserId: number; reason: SlateEntryReason }[] = [];

    for (const other of participants) {
      if (other.person.userId === viewer.person.userId) continue;

      const result = evaluateHardFilters(viewer.person, viewer.prefs, other.person, now);
      if (!result.passed) continue;

      // Distance is soft: out-of-range people rank below everyone in range and only
      // fill the slate when there aren't enough nearby (mirrors the meet-again idea).
      const distance = haversineKm(
        viewer.person.latitude, viewer.person.longitude,
        other.person.latitude, other.person.longitude,
      );
      const outOfRange = distance > viewer.prefs.maxDistanceKm;
      const filtersPassed = outOfRange ? result.filtersPassed : [...result.filtersPassed, 'distance'];

      // Previously-shown people aren't excluded outright; they rank last and only
      // fill the slate once the fresh pool is exhausted (the "meet again" fallback).
      const seen = opts.shownPairs.has(`${viewer.person.userId}:${other.person.userId}`);
      const mutual = isMutual(viewer.person, other.person);
      const score = seededScore(`${opts.roundSeed}:${viewer.person.userId}:${other.person.userId}`);
      scored.push({
        candidateUserId: other.person.userId,
        reason: { filtersPassed, mutual, score, meetAgain: seen, outOfRange },
      });
    }

    // In-range first, then fresh, then mutual, then by descending reproducible score.
    scored.sort((a, b) => {
      if (a.reason.outOfRange !== b.reason.outOfRange) return a.reason.outOfRange ? 1 : -1;
      if (a.reason.meetAgain !== b.reason.meetAgain) return a.reason.meetAgain ? 1 : -1;
      if (a.reason.mutual !== b.reason.mutual) return a.reason.mutual ? -1 : 1;
      return b.reason.score - a.reason.score;
    });

    const target = targetSlateSize(viewer.person.gender, balance, load);
    const size = Math.min(target, scored.length);
    const entries: SlateEntryPlan[] = scored.slice(0, size).map((s, i) => ({
      candidateUserId: s.candidateUserId,
      rank: i + 1,
      reason: s.reason,
    }));

    return { userId: viewer.person.userId, size, entries };
  });

  return { balance, slates };
}
