import { ageFromDob } from './geo';

/** The candidate/viewer data the algorithm needs (one row of joined profile data). */
export interface Person {
  userId: number;
  gender: string;
  sexualPreference: string; // 'male' | 'female' | 'everyone'
  genderModality: string | null; // 'cis' | 'trans' | 'unspecified' | null
  dateOfBirth: string;
  heightCm: number | null;
  latitude: number;
  longitude: number;
}

export interface Prefs {
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  includeTrans: boolean;
  minHeightCm: number | null;
  maxHeightCm: number | null;
}

/** Whether `gender` is acceptable to someone whose stated preference is `pref`. */
export function acceptsGender(pref: string, gender: string): boolean {
  return pref === 'everyone' || pref === gender;
}

/** True if `viewer` is acceptable to `candidate`'s orientation. */
export function isMutual(viewer: Person, candidate: Person): boolean {
  return acceptsGender(candidate.sexualPreference, viewer.gender);
}

export interface FilterResult {
  passed: boolean;
  /** Names of the hard filters that were applied and passed (used in the reason). */
  filtersPassed: string[];
}

/**
 * One direction: does `candidate` satisfy `prefs` (the preferences of the person looking)?
 * Returns the name of the first failing filter, or the list that passed.
 */
function oneWay(looker: Person, prefs: Prefs, candidate: Person, now: Date): { ok: boolean; passed: string[] } {
  const passed: string[] = [];
  if (!acceptsGender(looker.sexualPreference, candidate.gender)) return { ok: false, passed };
  passed.push('orientation');

  // Trans inclusion acts only on self-disclosed modality; it never bans anyone from the app.
  if (!prefs.includeTrans && candidate.genderModality === 'trans') return { ok: false, passed };

  const age = ageFromDob(candidate.dateOfBirth, now);
  if (age < prefs.minAge || age > prefs.maxAge) return { ok: false, passed };
  passed.push('age');

  if (prefs.minHeightCm !== null || prefs.maxHeightCm !== null) {
    const h = candidate.heightCm;
    if (h === null) return { ok: false, passed }; // a set filter excludes people who didn't say
    if (prefs.minHeightCm !== null && h < prefs.minHeightCm) return { ok: false, passed };
    if (prefs.maxHeightCm !== null && h > prefs.maxHeightCm) return { ok: false, passed };
    passed.push('height');
  }
  return { ok: true, passed };
}

/**
 * The hard filters (MECHANICS.md §1 step 1), applied **both ways** in v4: the candidate must
 * pass the viewer's filters *and* the viewer must pass the candidate's. A non-match never
 * appears. Distance is soft and handled by the engine.
 */
export function evaluateHardFilters(
  viewer: Person,
  viewerPrefs: Prefs,
  candidate: Person,
  candidatePrefs: Prefs,
  now: Date,
): FilterResult {
  const forward = oneWay(viewer, viewerPrefs, candidate, now);
  if (!forward.ok) return { passed: false, filtersPassed: forward.passed };
  const back = oneWay(candidate, candidatePrefs, viewer, now);
  if (!back.ok) return { passed: false, filtersPassed: forward.passed };
  return { passed: true, filtersPassed: forward.passed };
}
