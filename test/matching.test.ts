// Unit tests for the open matching algorithm — the same suite Vanity's backend runs.
// No DB, no clock: every `now` is injected.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, ageFromDob } from '../src/geo';
import { seededScore } from '../src/rng';
import { computeBalance, targetSlateSize } from '../src/balance';
import { acceptsGender, isMutual, evaluateHardFilters, type Person, type Prefs } from '../src/filters';
import { composeSlates, type Participant } from '../src/engine';
import { COMFORT_LOAD, MAX_SLATE_SIZE, ALGORITHM_VERSION } from '../src/version';

const NOW = new Date('2026-10-04T12:00:00Z');
const SD = { lat: 18.4861, lon: -69.9312 }; // Santo Domingo
const SANTIAGO = { lat: 19.4517, lon: -70.697 }; // ~135 km away

const openPrefs = (o: Partial<Prefs> = {}): Prefs => ({
  minAge: 18,
  maxAge: 99,
  maxDistanceKm: 100,
  includeTrans: true,
  minHeightCm: null,
  maxHeightCm: null,
  ...o,
});

const person = (userId: number, o: Partial<Person> = {}): Person => ({
  userId,
  gender: 'female',
  sexualPreference: 'male',
  genderModality: null,
  dateOfBirth: '1996-01-01',
  heightCm: 170,
  latitude: SD.lat,
  longitude: SD.lon,
  ...o,
});

const man = (id: number, o: Partial<Person> = {}): Person =>
  person(id, { gender: 'male', sexualPreference: 'female', heightCm: 180, ...o });
const woman = (id: number, o: Partial<Person> = {}): Person => person(id, o);
const P = (p: Person, prefs: Partial<Prefs> = {}): Participant => ({ person: p, prefs: openPrefs(prefs) });

const compose = (ps: Participant[], shown: string[] = [], seed: string | number = 1, blocked: string[] = []) =>
  composeSlates(ps, { roundSeed: seed, shownPairs: new Set(shown), blockedPairs: new Set(blocked), now: NOW });
const OPEN = openPrefs();
const hf = (viewer: Person, vp: Prefs, cand: Person, cp: Prefs = OPEN) => evaluateHardFilters(viewer, vp, cand, cp, NOW);

const slateOf = (r: ReturnType<typeof compose>, userId: number) => {
  const s = r.slates.find((x) => x.userId === userId);
  assert.ok(s, `no slate for ${userId}`);
  return s;
};

// ---------------------------------------------------------------------------
describe('geo.haversineKm', () => {
  test('zero for the same point', () => {
    assert.equal(haversineKm(SD.lat, SD.lon, SD.lat, SD.lon), 0);
  });
  test('Santo Domingo → Santiago is ~135 km and symmetric', () => {
    const d = haversineKm(SD.lat, SD.lon, SANTIAGO.lat, SANTIAGO.lon);
    assert.ok(d > 125 && d < 145, `got ${d}`);
    assert.equal(d, haversineKm(SANTIAGO.lat, SANTIAGO.lon, SD.lat, SD.lon));
  });
  test('one degree of latitude ≈ 111 km', () => {
    assert.ok(Math.abs(haversineKm(0, 0, 1, 0) - 111.19) < 0.1);
  });
  test('antipodes ≈ half the circumference', () => {
    assert.ok(Math.abs(haversineKm(0, 0, 0, 180) - Math.PI * 6371) < 0.001);
  });
});

describe('geo.ageFromDob', () => {
  test('the day before the 18th birthday is 17; on the day it is 18', () => {
    assert.equal(ageFromDob('2008-10-05', NOW), 17);
    assert.equal(ageFromDob('2008-10-04', NOW), 18);
  });
  test('earlier month / later month', () => {
    assert.equal(ageFromDob('1990-09-30', NOW), 36);
    assert.equal(ageFromDob('1990-11-01', NOW), 35);
  });
  test('leap-day birthday is not a year older on Feb 28 of a common year', () => {
    assert.equal(ageFromDob('2000-02-29', new Date('2025-02-28T12:00:00Z')), 24);
    assert.equal(ageFromDob('2000-02-29', new Date('2025-03-01T12:00:00Z')), 25);
  });
  test('uses UTC, so a late-evening instant west of UTC does not shift the age', () => {
    // 2026-10-04T23:30 in Santo Domingo (UTC-4) is already Oct 5 in UTC.
    assert.equal(ageFromDob('2008-10-05', new Date('2026-10-05T03:30:00Z')), 18);
  });
});

describe('rng.seededScore', () => {
  test('deterministic for the same seed', () => {
    assert.equal(seededScore('7:1:2'), seededScore('7:1:2'));
  });
  test('different seeds give different scores', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(seededScore(`1:1:${i}`));
    assert.ok(seen.size > 495, `only ${seen.size} distinct of 500`);
  });
  test('always in [0, 1) and roughly uniform', () => {
    let below = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const s = seededScore(`r:${i}`);
      assert.ok(s >= 0 && s < 1);
      if (s < 0.5) below += 1;
    }
    assert.ok(below > 4_700 && below < 5_300, `${below} of 10000 below 0.5`);
  });
  test('the round seed changes the ranking week to week', () => {
    assert.notEqual(seededScore('1:10:20'), seededScore('2:10:20'));
  });
});

// ---------------------------------------------------------------------------
describe('balance.computeBalance', () => {
  test('empty market', () => {
    const b = computeBalance([]);
    assert.equal(b.scarceGender, null);
    assert.equal(b.abundantGender, null);
    assert.equal(b.ratio, 1);
    assert.equal(b.scarceCount, 0);
  });
  test('single-gender market has no sides and ratio 1', () => {
    const b = computeBalance(['male', 'male', 'male']);
    assert.equal(b.scarceGender, null);
    assert.equal(b.abundantGender, null);
    assert.equal(b.ratio, 1);
    assert.deepEqual(b.countsByGender, { male: 3 });
  });
  test('4:1 market picks men as abundant, women as scarce', () => {
    const b = computeBalance([...Array(8).fill('male'), ...Array(2).fill('female')]);
    assert.equal(b.abundantGender, 'male');
    assert.equal(b.scarceGender, 'female');
    assert.equal(b.ratio, 4);
    assert.equal(b.abundantCount, 8);
    assert.equal(b.scarceCount, 2);
  });
  test('symmetric: a woman-heavy market flips the sides', () => {
    const b = computeBalance(['female', 'female', 'female', 'male']);
    assert.equal(b.abundantGender, 'female');
    assert.equal(b.scarceGender, 'male');
    assert.equal(b.ratio, 3);
  });
  test('third groups are counted but the two largest are the sides', () => {
    const b = computeBalance(['male', 'male', 'male', 'female', 'female', 'nonbinary']);
    assert.equal(b.abundantGender, 'male');
    assert.equal(b.scarceGender, 'female');
    assert.equal(b.countsByGender.nonbinary, 1);
  });
});

describe('balance.targetSlateSize', () => {
  const b = computeBalance([...Array(8).fill('male'), ...Array(2).fill('female')]);
  test('scarce side gets L', () => {
    assert.equal(targetSlateSize('female', b, 12), 12);
  });
  test('abundant side gets round(L / r)', () => {
    assert.equal(targetSlateSize('male', b, 12), 3);
  });
  test('people outside the two sides get L', () => {
    assert.equal(targetSlateSize('nonbinary', b, 12), 12);
  });
  test('never below 1 even in an extreme market', () => {
    const extreme = computeBalance([...Array(100).fill('male'), 'female']);
    assert.equal(targetSlateSize('male', extreme, 12), 1);
  });
  test('balanced 1:1 market gives everyone L', () => {
    const even = computeBalance(['male', 'female']);
    assert.equal(targetSlateSize('male', even, 12), 12);
    assert.equal(targetSlateSize('female', even, 12), 12);
  });
});

// ---------------------------------------------------------------------------
describe('filters (v4: mutual)', () => {
  test('acceptsGender: exact match or everyone', () => {
    assert.equal(acceptsGender('male', 'male'), true);
    assert.equal(acceptsGender('male', 'female'), false);
    assert.equal(acceptsGender('everyone', 'nonbinary'), true);
  });

  test('isMutual reads the candidate’s preference about the viewer', () => {
    assert.equal(isMutual(woman(1), man(2)), true);
    assert.equal(isMutual(woman(1), man(2, { sexualPreference: 'male' })), false);
  });

  test('orientation: viewer must accept the candidate’s gender', () => {
    assert.equal(hf(woman(1), OPEN, woman(2)).passed, false);
  });

  test('orientation is mutual: the candidate must accept the viewer’s gender too (AUDIT M1)', () => {
    assert.equal(hf(man(1, { sexualPreference: 'male' }), OPEN, man(2, { sexualPreference: 'female' })).passed, false);
    assert.equal(hf(man(1, { sexualPreference: 'male' }), OPEN, man(2, { sexualPreference: 'everyone' })).passed, true);
  });

  test('a fully open preference passes orientation + age only', () => {
    assert.deepEqual(hf(woman(1), OPEN, man(2)), { passed: true, filtersPassed: ['orientation', 'age'] });
  });

  test('age bounds are inclusive', () => {
    const cand = man(2, { dateOfBirth: '1996-10-04' }); // exactly 30 on NOW
    assert.equal(hf(woman(1), openPrefs({ minAge: 30, maxAge: 30 }), cand).passed, true);
    assert.equal(hf(woman(1), openPrefs({ minAge: 31 }), cand).passed, false);
    assert.equal(hf(woman(1), openPrefs({ maxAge: 29 }), cand).passed, false);
  });

  test('age is mutual: the viewer must be inside the candidate’s range (AUDIT M1)', () => {
    const viewer = man(1, { dateOfBirth: '1976-01-01' }); // 50
    assert.equal(hf(viewer, OPEN, woman(2), openPrefs({ maxAge: 35 })).passed, false);
    assert.equal(hf(viewer, OPEN, woman(2), openPrefs({ maxAge: 55 })).passed, true);
  });

  test('includeTrans=false excludes only self-disclosed trans candidates', () => {
    const prefs = openPrefs({ includeTrans: false });
    assert.equal(hf(woman(1), prefs, man(2, { genderModality: 'trans' })).passed, false);
    assert.equal(hf(woman(1), prefs, man(3, { genderModality: 'cis' })).passed, true);
    assert.equal(hf(woman(1), prefs, man(4, { genderModality: null })).passed, true);
    assert.equal(hf(woman(1), prefs, man(5, { genderModality: 'unspecified' })).passed, true);
  });

  test('trans inclusion is mutual too', () => {
    assert.equal(hf(woman(1, { genderModality: 'trans' }), OPEN, man(2), openPrefs({ includeTrans: false })).passed, false);
  });

  test('height range: inclusive, and a missing height fails a set filter', () => {
    const prefs = openPrefs({ minHeightCm: 175, maxHeightCm: 190 });
    assert.equal(hf(woman(1), prefs, man(2, { heightCm: 175 })).passed, true);
    assert.equal(hf(woman(1), prefs, man(3, { heightCm: 190 })).passed, true);
    assert.equal(hf(woman(1), prefs, man(4, { heightCm: 174 })).passed, false);
    assert.equal(hf(woman(1), prefs, man(5, { heightCm: null })).passed, false);
    assert.deepEqual(hf(woman(1), prefs, man(6, { heightCm: 180 })).filtersPassed, ['orientation', 'age', 'height']);
  });

  test('height is mutual as well', () => {
    assert.equal(hf(woman(1, { heightCm: 150 }), OPEN, man(2), openPrefs({ minHeightCm: 160 })).passed, false);
  });
});

// ---------------------------------------------------------------------------
describe('engine.composeSlates (v4)', () => {
  test('version stamp and limits', () => {
    assert.equal(ALGORITHM_VERSION, 'v4');
    assert.equal(COMFORT_LOAD, 6);
    assert.equal(MAX_SLATE_SIZE, 6);
  });

  test('empty market → no slates', () => {
    assert.deepEqual(compose([]).slates, []);
  });

  test('every participant gets a slate (possibly empty) and never sees themselves', () => {
    const r = compose([P(woman(1)), P(woman(2)), P(man(3)), P(man(4))]);
    assert.equal(r.slates.length, 4);
    for (const s of r.slates) {
      assert.ok(!s.entries.some((e) => e.candidateUserId === s.userId));
      assert.equal(s.size, s.entries.length);
    }
  });

  test('ranks are 1..n with no gaps', () => {
    const ranks = slateOf(compose([P(woman(1)), ...[2, 3, 4, 5].map((i) => P(man(i)))]), 1).entries.map((e) => e.rank);
    assert.deepEqual(ranks, [1, 2, 3, 4]);
  });

  test('deterministic: same inputs + same round seed → identical slates', () => {
    const ps = [P(woman(1)), P(woman(2)), ...[3, 4, 5, 6, 7].map((i) => P(man(i)))];
    assert.deepEqual(compose(ps, [], 42), compose(ps, [], 42));
  });

  test('a different round seed reshuffles the order (same set when everyone fits)', () => {
    const ps = [P(woman(1)), ...Array.from({ length: 5 }, (_, i) => P(man(i + 2)))];
    const a = slateOf(compose(ps, [], 1), 1).entries.map((e) => e.candidateUserId);
    const b = slateOf(compose(ps, [], 2), 1).entries.map((e) => e.candidateUserId);
    assert.deepEqual([...a].sort(), [...b].sort());
    assert.notDeepEqual(a, b);
  });

  test('no slate is ever larger than MAX_SLATE_SIZE', () => {
    const r = compose([P(woman(1)), ...Array.from({ length: 20 }, (_, i) => P(man(i + 10)))]);
    assert.equal(slateOf(r, 1).size, MAX_SLATE_SIZE);
  });

  test('balancing: in a 3:1 market the abundant side gets round(L/r), the scarce side up to L', () => {
    const women = [1, 2, 3, 4].map((i) => P(woman(i)));
    const men = Array.from({ length: 12 }, (_, i) => P(man(i + 10)));
    const r = compose([...women, ...men]);
    assert.equal(r.balance.ratio, 3);
    for (const m of men) assert.equal(slateOf(r, m.person.userId).size, Math.round(COMFORT_LOAD / 3));
    for (const w of women) assert.equal(slateOf(r, w.person.userId).size, COMFORT_LOAD);
  });

  test('inbound load: nobody appears on more than L slates in a round (AUDIT M2)', () => {
    // 30 men who all filter to 20–25; only one woman in that band.
    const target = P(woman(1, { dateOfBirth: '2004-01-01' }));
    const others = [2, 3].map((i) => P(woman(i, { dateOfBirth: '1985-01-01' })));
    const men = Array.from({ length: 30 }, (_, i) => P(man(i + 10), { minAge: 20, maxAge: 25 }));
    const r = compose([target, ...others, ...men]);
    const inbound = new Map<number, number>();
    for (const s of r.slates) for (const e of s.entries) inbound.set(e.candidateUserId, (inbound.get(e.candidateUserId) ?? 0) + 1);
    for (const [id, n] of inbound) assert.ok(n <= COMFORT_LOAD, `user ${id} is on ${n} slates (L = ${COMFORT_LOAD})`);
    assert.equal(inbound.get(1), COMFORT_LOAD);
  });

  test('capacity is shared fairly: the first L viewers in seeded order get the popular pick', () => {
    const target = P(woman(1));
    const men = Array.from({ length: 10 }, (_, i) => P(man(i + 10)));
    const r = compose([target, ...men]);
    const withHer = r.slates.filter((s) => s.entries.some((e) => e.candidateUserId === 1)).length;
    assert.equal(withHer, COMFORT_LOAD);
  });

  test('hard filters are applied per viewer, both ways', () => {
    const ps = [P(woman(1), { minAge: 25, maxAge: 35 }), P(man(2, { dateOfBirth: '1980-01-01' })), P(man(3, { dateOfBirth: '1995-01-01' }))];
    assert.deepEqual(slateOf(compose(ps), 1).entries.map((e) => e.candidateUserId), [3]);
    // Man 2 (46) isn't shown woman 1 either: he's outside her range.
    assert.equal(slateOf(compose(ps), 2).size, 0);
  });

  test('a gay man is never shown a straight man (mutual orientation)', () => {
    const ps = [P(man(1, { sexualPreference: 'male' })), P(man(2, { sexualPreference: 'female' }))];
    assert.equal(slateOf(compose(ps), 1).size, 0);
    assert.equal(slateOf(compose(ps), 2).size, 0);
  });

  test('blocked pairs never meet, in either direction (AUDIT R1)', () => {
    const ps = [P(woman(1)), P(man(2)), P(man(3))];
    const r = compose(ps, ['1:2'], 1, ['2:1']);
    assert.deepEqual(slateOf(r, 1).entries.map((e) => e.candidateUserId), [3]);
    assert.equal(slateOf(r, 2).size, 0);
  });

  test('ordering: in-range before out-of-range, even when out-of-range is fresh', () => {
    const ps = [P(woman(1), { maxDistanceKm: 50 }), P(man(2, { latitude: SANTIAGO.lat, longitude: SANTIAGO.lon })), P(man(3))];
    const s = slateOf(compose(ps, ['1:3']), 1);
    assert.deepEqual(s.entries.map((e) => e.candidateUserId), [3, 2]);
    assert.equal(s.entries[0]!.reason.outOfRange, false);
    assert.equal(s.entries[0]!.reason.meetAgain, true);
    assert.equal(s.entries[1]!.reason.outOfRange, true);
  });

  test('ordering: fresh before meet-again within range', () => {
    const s = slateOf(compose([P(woman(1)), P(man(2)), P(man(3)), P(man(4))], ['1:2', '1:3']), 1);
    assert.equal(s.entries[0]!.candidateUserId, 4);
    assert.equal(s.entries[0]!.reason.meetAgain, false);
    assert.ok(s.entries.slice(1).every((e) => e.reason.meetAgain));
  });

  test('shown pairs are directional', () => {
    const r = compose([P(woman(1)), P(man(2))], ['1:2']);
    assert.equal(slateOf(r, 1).entries[0]!.reason.meetAgain, true);
    assert.equal(slateOf(r, 2).entries[0]!.reason.meetAgain, false);
  });

  test('distance is soft: out-of-range candidates fill the slate when no one is in range', () => {
    const s = slateOf(compose([P(woman(1), { maxDistanceKm: 10 }), P(man(2, { latitude: SANTIAGO.lat, longitude: SANTIAGO.lon }))]), 1);
    assert.equal(s.size, 1);
    assert.ok(!s.entries[0]!.reason.filtersPassed.includes('distance'));
  });

  test('the reason carries every field the app explains, with the score it was ranked by', () => {
    const reason = slateOf(compose([P(woman(1)), P(man(2))], [], 9), 1).entries[0]!.reason;
    assert.deepEqual(Object.keys(reason).sort(), ['filtersPassed', 'meetAgain', 'mutual', 'outOfRange', 'score']);
    assert.equal(reason.score, seededScore('9:1:2'));
    assert.equal(reason.mutual, true);
    assert.deepEqual(reason.filtersPassed, ['orientation', 'age', 'distance']);
  });
});
