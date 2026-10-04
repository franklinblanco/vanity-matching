// Vanity — open matching algorithm. Public surface of the module.
// This is exactly the ruleset that composes a user's weekly slate; there is no
// second, hidden ranker. See README.md for the pipeline.

export { ALGORITHM_VERSION, COMFORT_LOAD, MAX_SLATE_SIZE } from './version';
export { seededScore } from './rng';
export { haversineKm, ageFromDob } from './geo';
export {
  computeBalance,
  targetSlateSize,
  type MarketBalance,
} from './balance';
export {
  acceptsGender,
  isMutual,
  evaluateHardFilters,
  type Person,
  type Prefs,
  type FilterResult,
} from './filters';
export {
  composeSlates,
  type Participant,
  type ComposeOptions,
  type ComposeResult,
  type SlatePlan,
  type SlateEntryPlan,
  type SlateEntryReason,
} from './engine';
