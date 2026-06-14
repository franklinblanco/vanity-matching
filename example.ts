/**
 * A tiny, runnable demonstration of the open matching algorithm.
 *
 *   npm install && npm run example
 *
 * It builds a small make-believe market (a lopsided 5 women / 2 men ratio),
 * composes everyone's weekly slate, and prints each slate with the *reason*
 * each person appears — the same transparent output the app shows. Run it twice:
 * the seeded ranking is identical, because the algorithm is deterministic.
 */
import { composeSlates, type Participant, type Person, type Prefs } from './src/index';

// Brooklyn-ish coordinates; everyone is near enough to be in-range here.
const HERE = { lat: 40.68, lon: -73.97 };

function person(userId: number, gender: string, pref: string, age: number): Person {
  const year = new Date().getUTCFullYear() - age;
  return {
    userId,
    gender,
    sexualPreference: pref,
    genderModality: 'cis',
    dateOfBirth: `${year}-06-01`,
    heightCm: null,
    weightG: null,
    countryOfBirthId: 1,
    latitude: HERE.lat + (Math.random() - 0.5) * 0.05,
    longitude: HERE.lon + (Math.random() - 0.5) * 0.05,
  };
}

const prefs: Prefs = {
  minAge: 21,
  maxAge: 45,
  maxDistanceKm: 25,
  includeTrans: true,
  nationalityCountryIds: null,
  minHeightCm: null,
  maxHeightCm: null,
  minWeightG: null,
  maxWeightG: null,
};

const p = (person: Person): Participant => ({ person, prefs });

const market: Participant[] = [
  p(person(1, 'female', 'male', 27)),
  p(person(2, 'female', 'male', 31)),
  p(person(3, 'female', 'everyone', 24)),
  p(person(4, 'female', 'male', 29)),
  p(person(5, 'female', 'male', 35)),
  p(person(6, 'male', 'female', 30)),
  p(person(7, 'male', 'everyone', 28)),
];

const { balance, slates } = composeSlates(market, {
  roundSeed: 'demo-round-1',
  shownPairs: new Set(), // nobody has been shown to anyone yet
});

console.log('Market balance:', balance, '\n');
for (const slate of slates) {
  const viewer = market.find((m) => m.person.userId === slate.userId)!.person;
  console.log(`User #${slate.userId} (${viewer.gender}) — slate of ${slate.size}:`);
  for (const e of slate.entries) {
    const r = e.reason;
    const tags = [
      r.mutual ? 'mutual' : 'one-way',
      ...r.filtersPassed,
      r.meetAgain ? 'meet-again' : null,
      r.outOfRange ? 'further' : null,
    ].filter(Boolean);
    console.log(`  ${e.rank}. user #${e.candidateUserId}  [${tags.join(', ')}]  score=${r.score.toFixed(4)}`);
  }
  console.log('');
}
