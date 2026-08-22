# Deliverable Ideas

**Status:** survey for a decision. Lists candidate deliverables; ends with a recommendation. Nothing is chosen yet.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md), [tooling-catalog.md](tooling-catalog.md)

---

## The question

The README states goals (faster work, fewer tokens) but no artifact. "Done" needs a noun: the thing a
future session — or another repo — installs and uses. This document lists the candidate nouns, groups
them by whether they are built, adopted, packaged, or merely linked, and proposes a first choice.

The operating profile the choice must serve: **one human, one repo, very fast iteration, Claude Code
as the primary agent**, with two secondary ambitions — generalize to the author's other repos, and
port the core idea beyond Claude.

## Selection criteria

1. **Serves the solo fast-iteration loop first.** Team and enterprise concerns are out of scope.
2. **Claude-first, portable core.** Core logic lives in a plain CLI plus files on disk; the
   Claude-specific layer (hooks, MCP, skills, CLAUDE.md) stays a thin adapter, so an AGENTS.md +
   CLI adapter can be added later without redesign.
3. **Retrofittable.** Must install into an *existing* repo, not only a fresh template — the author's
   real estate is existing repos.
4. **Measurable.** Must plausibly move tokens-per-completed-task or wall-clock-per-task at a fixed
   quality bar. That ratio, not burn rate, is the metric.
5. **Buy over build.** Anything the tooling catalog covers is adopted, not rebuilt.
6. **Small maintenance surface.** Each shipped piece is a liability; fewer, composed pieces win.

---

## Candidates — build

- **B1. `platonic` uber-CLI.** One entry point with subcommands (`init`, `check`, `gate`, `ratchet`,
  `index`, `bench`). Agents and humans learn one command; complexity hides behind it. Most other
  build ideas below are facets of this tool.
- **B2. Gate daemon.** Persistent aggregator over `tsc --watch`, `vitest --watch`, and ESLint that
  answers "is the repo green, and if not, what is the root cause" in a compact verdict. The
  token-economy centerpiece from the framework notes (section 6).
- **B3. Escape-hatch ratchet.** Committed baseline counts of `any`, `as`, `!`, `@ts-ignore`,
  `eslint-disable`; fails on increase, re-baselines on decrease (framework notes, section 4). Small,
  standalone, useful in any TypeScript repo on day one.
- **B4. Verdict compactor.** Deduplicates compiler/linter/test output by root cause (owning file and
  error code, not consequence count) into a bounded-token summary. A component of B2, but useful
  standalone as a CI formatter.
- **B5. Repo index generator.** Auto-built orientation file (package map, exports, purposes)
  regenerated on commit, so agents orient without spelunking. Serves the "auto-created indexes"
  approach bullet; overlaps API Extractor output and could be derived from it.
- **B6. MCP server.** Exposes gate verdicts, ratchet status, and code navigation (wrapping
  `tsserver`) as tools Claude calls directly. The Claude adapter over B1/B2.
- **B7. Claude Code plugin.** Bundles skills (house style, workflow), hooks (post-edit gate check),
  the MCP server, and a CLAUDE.md template into one installable unit. The Claude-first packaging of
  everything above.
- **B8. Measurement harness.** Parses Claude Code session logs into tokens-per-task,
  turns-per-task, gate-failures-per-task; later, replay of a task corpus across rule sets and model
  tiers. The path from anecdote to evidence (framework notes, section 9).
- **B9. Work ledger.** File-claim and task-state convention so concurrent agents wait and recover.
  Deliberately minimal if package fences do the structural work. Candidate for adoption instead
  (see A-row on trackers below).
- **B10. Model-tier dispatcher.** Routes subtasks to cheaper or stronger models based on gate
  safety. A later facet of B1/B7, only sensible after B3 exists.
- **B11. Custom lint-rule pack.** The few subset rules with no off-the-shelf implementation
  (module-level side-effect config, curated ambient-impurity ban as a shareable preset).
- **B12. Codemod kit.** `ast-grep` rule library for the mechanical fixes the subset demands, so
  repo-wide changes cost zero agent tokens.
- **B13. `platonic init` retrofitter.** Installs the configs, check script, ratchet, and CLAUDE.md
  into an existing repo with a graduated strictness profile. This is the multi-repo
  generalization mechanism, and eventually the bridge to a C# profile alongside
  [Platonic.CSharp](https://github.com/cdiggins/Platonic.CSharp).
- **B14. Reference application.** One real project (something Ara 3D actually needs) built under
  the method. Not a product: the proving ground, demo, and measurement corpus.
- **B15. Decision and idea log convention.** Append-only `decisions.md` / `ideas.md` files agents
  may write to, satisfying "track the decision-making process" and "let agents generate and track
  ideas" without a database.

## Candidates — adopt (use, don't build)

The tooling catalog's shortlist stands in for this section: pnpm workspaces, strict `tsc`, ESLint +
typescript-eslint + eslint-plugin-functional, Vitest, dependency-cruiser, knip, ast-grep, API
Extractor, Prettier. Two additions specific to this list:

- **Agent task trackers** (beads, Backlog.md) as an alternative to building B9/B15.
- **AGENTS.md convention** as the portability mirror of CLAUDE.md.

## Candidates — package (how it ships)

- **P1.** `platonic` CLI on npm (carries B1-B5, B13).
- **P2.** `@platonic/tsconfig` and `@platonic/eslint-config` presets.
- **P3.** GitHub template repository (new-project path; thin wrapper over P1+P2).
- **P4.** Claude Code plugin (B7) in a marketplace.
- **P5.** The methodology itself: the docs/ essays kept publishable as the written deliverable.

## Candidates — link (reference, never own)

AGENTS.md spec, Anthropic's Claude Code best practices, Platonic.CSharp (sibling project),
Superpowers (contrasting process-discipline approach), Unison (prior art for cached pure tests),
the METR 2025 developer-productivity RCT (why measurement beats anecdote).

---

## Convergence

The build list is long but collapses into **three product centers plus a proving ground**:

| Center | Composed of | What it is |
|---|---|---|
| **A. The tool** | B1 + B2 + B3 + B4 + B5 + B13, adapted to Claude by B6 + B7 | One gate/dispatch CLI: the "single uber-tool that gates and dispatches efficiently" |
| **B. The configuration** | P2 + P3 + B11 | The subset, shipped as installable presets |
| **C. The evidence loop** | B8 + B15 (+ B10 later) | Measurement that decides which rules stay |
| **Proving ground** | B14 | A real project the method must survive |

Anything not in this table (B9 ledger, B12 codemods) is either adopted, deferred, or folded in later.

## Recommendation

Build **A in minimal form inside B**: strict tsconfig + `check` script + ESLint subset preset +
ratchet (B3) as `platonic check` — a few days of work per the framework notes' own estimates — and
retrofit it into one existing repo with B13 as soon as it works in this one. Turn on **C passively**
from day one (session-log parsing only; no experiments yet). Grow A into the gate daemon (B2 + B4)
next, because that is where the token payoff arrives. B14 starts as soon as `platonic check` exists,
because every later decision should be made against evidence from a real repo.

Once the choice is confirmed, the non-goals fall out mechanically: not an agent harness (Claude Code
is), not a task tracker (adopt one), not a new language (Plato exists), not a team coordination
platform (solo operator), not a public benchmark. Until then these remain candidates, not
commitments.
