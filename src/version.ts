/**
 * Version of the open matching algorithm. Stamped onto every round so users can see which
 * ruleset produced their slate (transparency pillar). Bump on any change to the pipeline.
 *
 * v4 (2026-10): orientation, age, trans-inclusion and height filters are mutual; per-person
 * inbound load is capped at L; blocked pairs never meet; slates hold at most 6 people.
 */
export const ALGORITHM_VERSION = 'v4';

/** Comfort cap `L`: the most slates any one person may appear on per round (MECHANICS.md §1). */
export const COMFORT_LOAD = 6;

/** Hard upper bound on any slate's size — "a few great options", not a feed. */
export const MAX_SLATE_SIZE = 6;
