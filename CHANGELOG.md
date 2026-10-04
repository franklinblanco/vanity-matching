# Changelog

Every change to the ruleset bumps `ALGORITHM_VERSION`, which Vanity stamps on every weekly round.

## v4 — 2026-10-05
- **Matching is mutual.** Orientation, age range, trans-inclusion and height filters now apply both
  ways: someone only appears on your slate if you're inside *their* preferences too. In v3 orientation
  and age were one-directional (mutual pairs were only ranked first), so a person could be shown — and
  messaged by — someone outside their own preferences.
- **The inbound cap is enforced per person.** Nobody appears on more than `L` slates in a round. v3
  only balanced load *on average*; when everyone's filters pointed at the same few people, those people
  could land on every slate. Slots are now handed out round-robin by slate position in a seeded viewer
  order, skipping anyone who has reached `L`.
- **Blocked pairs never meet**, not even through the meet-again fallback.
- **Smaller slates**: `L` 12 → 6, and no slate holds more than 6 people.
- **No paid filters**: nationality and weight filters were removed.
- `reason.mutual` is now always `true` (kept so the reason shape is stable).

## v3 — 2026-06
- Distance became soft: people beyond your distance only fill your slate when nobody nearby is left.
- Meet-again fallback: previously shown people rank last instead of being excluded forever.
