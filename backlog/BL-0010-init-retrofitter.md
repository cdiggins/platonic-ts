---
id: BL-0010
title: Build platonic init retrofitter for existing repos
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-22
closed:
links: [BL-0001, docs/deliverable-ideas-2026-08-22.md]
---

## Idea
Right now platonic-ts only runs against itself — `npm run check` invokes
`packages/check/src/main.ts` inside this repo, no `bin`, everything `"private": true`. User
wants a tool that installs platonic-ts into a *different*, already-existing repo: drop in the
configs, the check script, the ratchet baseline, CLAUDE.md, at whatever strictness the target
repo can currently pass. This is the doc's own **B13** ("`platonic init` retrofitter") and
**P1** ("`platonic` CLI on npm") candidates, not a new idea — it names the next step the README
already calls out as a later ambition ("Generalizing to multiple repositories is a later
ambition").

## Assumptions
- `platonic check` (BL-0001, done) is stable enough in this repo to be worth exporting.
- A retrofit target repo may already have its own tsconfig/eslint config/CI — init must not
  clobber without a graduated/opt-in strictness profile, per the deliverable-ideas doc's
  criterion 3 (**Retrofittable**).
- Packaging as an installable CLI (`npx platonic init`, or similar) requires `packages/check`
  (and whatever else ships) to stop being `"private": true` and gain a `bin` entry — currently
  neither exists.

## Design decisions
- Distribution — npm-published CLI (P1) vs GitHub template repo (P3) vs local script copied by
  hand. Doc recommends P1 (installable) over P3 (new-project-only, doesn't retrofit).
- Scope of what `init` copies — full A-center (check + gate + ratchet + index, per the
  Convergence table) vs just B3 (ratchet) + strict tsconfig as a minimal first cut.
- Strictness handling — how graduated onboarding works when the target repo fails `platonic
  check` on day one (ratchet baselines at current count vs hard-fails immediately).
- Claude-specific layer — whether `init` also drops CLAUDE.md/skills (B7 territory) or stays
  strictly the portable CLI+files core (criterion 2: Claude-specific stuff is a thin adapter,
  not baked into the retrofitter).

## Related
- [BL-0001](BL-0001-platonic-check.md) — `platonic check` is the thing being retrofitted; done, so this is unblocked.
- [docs/deliverable-ideas-2026-08-22.md](../docs/deliverable-ideas-2026-08-22.md) — names this exact idea as B13/P1, already scored against 6 selection criteria and slotted into the "A. The tool" convergence center; read this before scoping BL-0010 further, don't re-derive from scratch.
- [README.md](../README.md) — "Generalizing to multiple repositories is a later ambition" states this is intentionally deferred, not forgotten.

## Approaches
Short term:
- Minimal retrofitter: a script/CLI subcommand that copies `tsconfig.json` + ESLint subset
  config + a ratchet baselined at the target repo's *current* escape-hatch counts (so it starts
  green, then only ratchets down) + a `check` npm script wired to `@platonic/check`.
- Dogfood on one of the user's own other repos (B14 "reference application" territory) before
  publishing anything — proves the graduated-strictness idea against real drift, not a demo repo.

Long term:
- Package as `platonic` CLI on npm (P1) with `init`, `check`, and later `gate`/`ratchet`/`index`
  subcommands per B1's uber-CLI shape.
- Bridge to a C# profile alongside Platonic.CSharp once the TS retrofitter pattern is proven.

Adjacent ideas worth their own item:
- Publishing `@platonic/tsconfig` / `@platonic/eslint-config` as standalone presets (P2) —
  needed by init but usable independently.
- Claude Code plugin packaging (B7/P4) once there's a CLAUDE.md template worth bundling.

## Bedrock
The seam this strengthens: today "platonic-ts" is one word for "this repo's local dev
scripts" — there is no boundary between the method and this codebase. Building `init` forces
that boundary to become real: `packages/check` has to declare what it actually needs from a
host repo (a tsconfig to extend, an eslint config to extend, a ratchet file format) instead of
assuming it. That boundary is what makes every later B1 subcommand (`gate`, `ratchet`,
`index`) portable for free, and it's what makes B14 (a real proving-ground repo) possible at
all. Verdict: **simplest-along-the-grain** — the minimal copy-configs-and-baseline-the-ratchet
version is enough for a first retrofit, but it must not hardcode any assumption specific to
this repo's file layout (package names, workspace paths) or the boundary doesn't hold for repo
number two.

## Simplest possible implementation
A single script (not yet a published CLI): `tsx packages/check/src/init.ts <target-repo-path>`
that (1) copies the strict `tsconfig.json` and ESLint subset config into the target repo,
extending rather than overwriting if configs already exist, (2) runs the escape-hatch counters
against the target repo as it stands today and writes that as the initial `ratchet.json`
baseline, (3) adds a `check` script to the target's `package.json` pointing at
`@platonic/check`.

- Gets: a real, testable retrofit path today, no npm publish/versioning/bin-entry work needed
  yet, immediately dogfoodable on a second repo.
- Gives up: no `npx platonic init` ergonomics, no distribution outside repos the user can `tsx`
  into directly, no graduated-strictness *profile* (single strictness level) — those wait for
  the npm-published P1 CLI.

## Done means
- [ ] `packages/check` (or a new `packages/init`) exposes a script that installs
      tsconfig+eslint+ratchet+check-script into an existing target repo without overwriting
      unrelated config
- [ ] Run against at least one real external repo; that repo can run its own `check` script
      and gets a ratchet baselined at its current (non-zero) escape-hatch counts
- [ ] No hardcoded platonic-ts-specific paths/package names in the copied output
