/**
 * Version of the open matching algorithm. Stamped onto every round so users can
 * see which ruleset produced their slate (transparency pillar). Bump on any
 * change to the pipeline in this module.
 */
export const ALGORITHM_VERSION = 'v3';

/** Comfort cap `L`: max inbound load per scarce-side user per round (MECHANICS.md §1). */
export const COMFORT_LOAD = 12;
