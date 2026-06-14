import { ageFromDob } from './geo';

/** The candidate/viewer data the algorithm needs (one row of joined profile data). */
export interface Person {
  userId: number;
  gender: string;
  sexualPreference: string; // 'male' | 'female' | 'everyone' | ...
  genderModality: string | null; // 'cis' | 'trans' | null
  dateOfBirth: string;
  heightCm: number | null;
  weightG: number | null;
  countryOfBirthId: number;
  latitude: number;
  longitude: number;
}

export interface Prefs {
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  includeTrans: boolean;
  nationalityCountryIds: number[] | null;
  minHeightCm: number | null;
  maxHeightCm: number | null;
  minWeightG: number | null;
  maxWeightG: number | null;
}

/** Whether `gender` is acceptable to someone whose stated preference is `pref`. */
export function acceptsGender(pref: string, gender: string): boolean {
  return pref === 'everyone' || pref === gender;
}

/** True if `viewer` is acceptable to `candidate`'s orientation (mutual interest). */
export function isMutual(viewer: Person, candidate: Person): boolean {
  return acceptsGender(candidate.sexualPreference, viewer.gender);
}

export interface FilterResult {
  passed: boolean;
  /** Names of the hard filters that were applied and passed (used in the reason). */
  filtersPassed: string[];
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (value === null) return false; // a set filter excludes candidates missing the attribute
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/**
 * Applies the hard filters from MECHANICS.md §1 step 1. Returns whether the
 * candidate survives and which filters were checked (all listed filters passed
 * when `passed` is true).
 */
export function evaluateHardFilters(
  viewer: Person,
  prefs: Prefs,
  candidate: Person,
  now: Date,
): FilterResult {
  const filtersPassed: string[] = [];

  if (!acceptsGender(viewer.sexualPreference, candidate.gender)) return fail();
  filtersPassed.push('orientation');

  // Trans inclusion is the viewer's own, symmetric preference (inclusive default).
  // It only acts on self-disclosed modality; it never bans anyone from the app.
  if (!prefs.includeTrans && candidate.genderModality === 'trans') return fail();

  const age = ageFromDob(candidate.dateOfBirth, now);
  if (age < prefs.minAge || age > prefs.maxAge) return fail();
  filtersPassed.push('age');

  // Distance is handled as a soft filter in the engine (out-of-range people only
  // appear when there's no one in range), so it's not a hard fail here.

  if (prefs.nationalityCountryIds && prefs.nationalityCountryIds.length > 0) {
    if (!prefs.nationalityCountryIds.includes(candidate.countryOfBirthId)) return fail();
    filtersPassed.push('nationality');
  }

  if (prefs.minHeightCm !== null || prefs.maxHeightCm !== null) {
    if (!inRange(candidate.heightCm, prefs.minHeightCm, prefs.maxHeightCm)) return fail();
    filtersPassed.push('height');
  }

  if (prefs.minWeightG !== null || prefs.maxWeightG !== null) {
    if (!inRange(candidate.weightG, prefs.minWeightG, prefs.maxWeightG)) return fail();
    filtersPassed.push('weight');
  }

  return { passed: true, filtersPassed };

  function fail(): FilterResult {
    return { passed: false, filtersPassed };
  }
}
