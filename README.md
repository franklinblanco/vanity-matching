# Vanity — the matching algorithm

This is the **open, inspectable** matching algorithm behind [Vanity](https://vanity.dating),
a dating app built on the idea that you should be able to *see why* you're seeing who you're seeing.

There is no second, hidden ranker. **What's in this repository is exactly what runs in production**
to compose each user's weekly slate. The current ruleset is `ALGORITHM_VERSION` in
[`src/version.ts`](./src/version.ts) (currently **`v4`**), and that version string is stamped onto
every round so anyone can tell which rules produced their results.

Most dating apps treat their matching as a trade secret — a black box that decides who you get to
see, with incentives that aren't yours. Vanity's bet is the opposite: **transparency is the feature.**
So here it is, MIT-licensed, runnable in ten seconds.

## What it does

For each active user in a local market, at the start of a weekly round, it builds a **slate**: an
ordered, deliberately small set of candidates — each carrying a structured *reason* it appears
("mutual", which filters it passed, whether it's a second-chance "meet-again", etc.). The app shows
that reason verbatim.

Two ideas drive it:

- **Scarcity by design.** You get a few well-matched people per week, not an infinite feed.
- **Marketplace balancing.** Slate sizes float with the *real* local gender ratio so the scarce side
  isn't buried under inbound interest and the abundant side isn't starved — instead of a fixed
  "show this side N, that side M" multiplier.

## The pipeline (per user `u`)

1. **Candidate pool** — every other eligible person in the same market (the app filters for complete,
   visible, consented profiles before calling the algorithm).
2. **Hard filters, both ways** — a non-match never appears. `c` must pass `u`'s filters **and** `u`
   must pass `c`'s:
   - **orientation** — each accepts the other's gender;
   - **age** — each is inside the other's `[minAge, maxAge]`;
   - **trans inclusion** — each person's own preference, acting only on self-disclosed modality
     (inclusive by default; it never bans anyone from the platform);
   - **height** — only if set.
3. **Blocks** — pairs where either person blocked the other are never composed.
4. **Distance is *soft*** — people beyond `u`'s `maxDistanceKm` rank below everyone in range and only
   fill the slate when there aren't enough people nearby.
5. **Freshness** — people already shown to `u` rank below fresh ones (the "meet again" fallback).
6. **Ranking** — a **documented, deterministic** pseudo-random score in `[0, 1)`, seeded by
   `roundSeed:viewerId:candidateId` (FNV-1a → mulberry32, [`src/rng.ts`](./src/rng.ts)). Order:
   in-range, fresh, then score. Anyone can recompute it.
7. **Sizing** (the balancing model) — the two largest gender groups are `scarce` and `abundant`, with
   ratio `r = |abundant| / |scarce|` and comfort cap `L = 6`. Scarce-side slates hold up to `L`; the
   abundant side about `L / r` (≥ 1); no slate holds more than 6.
8. **Capacity-capped assignment** — **nobody appears on more than `L` slates in a round.** Slots are
   handed out round-robin by slate position (everyone's first pick before anyone's second) in a seeded
   viewer order; anyone who has reached `L` is skipped. This is what keeps the most-wanted people from
   being buried, per person rather than on average.

See [`CHANGELOG.md`](./CHANGELOG.md) for what changed from v3.

## It's pure

`composeSlates(participants, opts)` does **no I/O** — no database, no network, no clock unless you
pass one (`opts.now`). Inputs in, slates out. That's what makes it testable and inspectable: given
the same round seed, participants, and preferences, it always produces the same slates. The only
nondeterminism is *who's in the market*, which is data, not logic.

## Run it

```bash
npm install
npm run example
npm test        # the same unit tests the app's backend runs
```

[`example.ts`](./example.ts) builds a small, deliberately lopsided market (5 women / 2 men), composes
everyone's slate, and prints each one with its reasons. Run it twice — the output is identical,
because the ranking is deterministic.

```ts
import { composeSlates, type Participant } from './src/index';

const { balance, slates } = composeSlates(participants, {
  roundSeed: 'round-2026-W24',
  shownPairs: new Set(), // "viewerId:candidateId" pairs already shown
});
```

## Layout

| File | What's in it |
|---|---|
| [`src/engine.ts`](./src/engine.ts) | `composeSlates` — the pipeline that ties it all together |
| [`src/filters.ts`](./src/filters.ts) | hard filters, orientation/mutuality, the `Person`/`Prefs` shapes |
| [`src/balance.ts`](./src/balance.ts) | the marketplace-balancing model and slate sizing |
| [`src/rng.ts`](./src/rng.ts) | the deterministic seeded score |
| [`src/geo.ts`](./src/geo.ts) | haversine distance, age-from-DOB |
| [`src/version.ts`](./src/version.ts) | `ALGORITHM_VERSION`, `COMFORT_LOAD`, `MAX_SLATE_SIZE` |
| [`test/`](./test) | unit tests (`node:test`) |

## Scope

This repo is the matching algorithm only — the part we want open. It's a faithful snapshot of the
`v4` ruleset running in the app. The rest of Vanity (accounts, chat, storage, the API) is a separate,
private codebase. Found something you'd improve? Open an issue — critique of the algorithm is exactly
the point.

## License

MIT — see [`LICENSE`](./LICENSE).
