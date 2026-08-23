---
id: BL-0022
title: Keep caveman for working output, make final answers clear
type: idea
status: idea
priority: "?"
effort: "?"
risk: low
area: repo
sprint:
created: 2026-08-23
closed:
links: [docs/tools-and-process.md, NOTES.md]
---

## Idea

Caveman mode (user-global skill `~/.claude/skills/caveman/SKILL.md`, always on per global
CLAUDE.md) saves measured ~65% output tokens, but the *final* answer of a task is sometimes
too compressed to understand, forcing a follow-up "clarify" round trip — which costs more
tokens and time than plain output would have. The observed net effect: compression on the
deliverable can be worse than no compression. The user does not want regular verbose
LLM-style output either. Open question set: keep caveman on by default? new skill? edit the
skill/agent prompt? measure first? Interpretation: the real problem is **position-blind
compression** — one style for both intermediate working output (where compression is nearly
free) and the final deliverable message (where comprehension is the whole point). The known
partial fix: the user had success with a role prompt ("explain as a professional technical
writer, succinct, minimal jargon") — which is almost verbatim the writing-rules section of
the existing `speak-plainly` skill.

## Assumptions

- Caveman's savings are real and worth keeping for intermediate output (65% claim in
  docs/tools-and-process.md:172-176; session numbers in NOTES.md were gathered under it).
- Clarification round trips happen often enough to matter (not yet measured — see metrics
  approach below).
- The skills are user-global, so a fix lives in `~/.claude/skills/` or global CLAUDE.md, not
  this repo; this item tracks the decision and any measurement tooling, which may live here.
- Claude Code reliably honors a per-position style rule ("working updates compressed, final
  message clear") within one skill — plausible but unverified.

## Design decisions

- **Where clarity kicks in** — (A) final-message-only rule added to caveman's Auto-Clarity
  list ("final deliverable answer of a task" joins security warnings etc.) vs (B) drop
  caveman default, invoke it only for subagents/working sessions vs (C) keep caveman full
  everywhere, rely on `speak-plainly` on demand. A keeps savings and fixes the pain at the
  source; B is simplest but loses working-output savings; C is status quo (the pain).
- **Clarity register** — caveman-lite (tight professional, full sentences) vs speak-plainly
  technical-writer rules. Lite still compresses; speak-plainly optimizes comprehension.
  Probably: lite for short answers, speak-plainly register for multi-part task wrap-ups.
- **Measure first or fix first** — caveman-stats already reads real session-log token
  numbers. Counting clarification round trips (user says "explain"/"clarify"/"what does
  that mean" after a final answer) needs a transcript scan — small script, doable, but the
  fix is cheap enough that measuring first may be over-engineering.

## Related

- `~/.claude/skills/speak-plainly/SKILL.md` — already implements the "professional
  technical writer" role the user found effective, as a one-shot override; this idea makes
  that register the *default* for final answers instead of an on-demand rescue.
- `~/.claude/skills/caveman/SKILL.md` — Auto-Clarity section already drops caveman for
  security warnings, irreversible actions, ambiguity; the natural seam for a "final
  deliverable" clause. Also already has the `lite` level.
- `~/.claude/skills/caveman-stats/SKILL.md` — real token numbers from session logs; the
  measurement building block if metrics come first.
- docs/tools-and-process.md:172-176 — records the 65% saving claim and that NOTES.md token
  numbers were gathered under caveman.
- [BL-0021] — same theme of skill placement (global vs vendored); if caveman gets edited,
  same global-vs-repo question applies.

## Approaches

Short term:
1. **Edit caveman Auto-Clarity** (strongest): add one clause — "Final deliverable answer of
   a task: write caveman-lite at minimum; for multi-part results use speak-plainly register.
   Intermediate/status output stays at active level." One file, immediate, reversible.
2. **Prompt-level habit**: append the technical-writer role line to global CLAUDE.md for
   final summaries only. No skill surgery, but CLAUDE.md rules compete with skill rules.
3. **Measure first**: script over session logs counting clarify-follow-ups within N turns of
   a final answer; decide with data. Pairs with caveman-stats.

Long term: per-position styles as first-class skill concept (working / final / subagent
report registers); subagents stay ultra (cavecrew), user-facing finals stay clear.

Adjacent ideas worth their own item: clarification-round-trip counter as a metrics script
(only if measuring becomes recurring, not one-off).

## Bedrock

The seam is caveman's existing **Auto-Clarity list** — the skill already encodes "clarity
beats compression when stakes are high"; adding "final deliverable" is extending an existing
invariant, not bolting on a mode. That keeps one source of truth for when compression yields
(vs a competing CLAUDE.md rule that fights the skill). Verdict:
**simplest-along-the-grain**. The simple version must NOT add a second style-switching
mechanism outside the caveman skill (no separate CLAUDE.md style rule, no new skill) — the
Auto-Clarity list stays the single place that decides when caveman yields.

## Done means

- [ ] Caveman skill (or successor rule) distinguishes final deliverable answers from
      intermediate output, in writing.
- [ ] A task wrap-up produced under the new rule reads clearly without a follow-up
      clarification (spot-check over a few real sessions).
- [ ] Intermediate/status output still compressed (caveman-stats numbers not materially
      worse on working turns).
- [ ] docs/tools-and-process.md caveman paragraph updated if behavior changed.

## Simplest possible implementation

Add one bullet to the Auto-Clarity section of `~/.claude/skills/caveman/SKILL.md`:
"Final deliverable answer of a completed task — write caveman-lite; multi-part wrap-ups use
speak-plainly writing rules. Resume active level next turn." No new files, no metrics.

Pros:
- One-line change at the exact seam built for this; reversible instantly.
- Reuses two existing, tested registers (lite, speak-plainly) instead of inventing one.
- Keeps the 65% saving on the bulk of output (intermediate turns, subagents).

Cons:
- No baseline measurement — won't know if clarify round trips actually drop.
- "Final deliverable answer" boundary is judgment; model may misclassify long mid-task
  updates and pay full verbosity on them.
- Edits a user-global skill shared across repos — behavior changes everywhere, and the
  change is not version-controlled in this repo (BL-0021's vendoring question again).
