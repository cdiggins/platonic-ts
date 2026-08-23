---
id: BL-0022
title: Drop caveman default — measured saving ~2%, override cost ~11% of turns
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
CLAUDE.md) claims ~65% output-token saving (unverified vendor claim — see Measurements
below), but the *final* answer of a task is sometimes
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

## Measurements (2026-08-23)

Transcript scan over all 32 sessions of this project (~148M tokens processed,
deduplicated across resumed sessions; token counts from usage fields, prose sizes
estimated at 4 chars/token):

- Assistant visible text — the ONLY slice caveman compresses: ~45k est. tokens.
  Thinking: ~48k (same size, never compressed). Tool-call arguments: ~185k (4× the
  text, never compressed). Billed output tokens: 1.474M.
- Ceiling on caveman's effect even at 100% compression: ~3% of output tokens,
  ~0.7% of fresh input (cache writes + uncached), ~0.03% of total tokens processed,
  and roughly ~1% of dollar cost when price-weighted (output expensive, cache reads
  cheap). At the claimed 65%, realized saving ≈ 2% of output tokens, ≈ 0.5% of cost.
- The 65% claim itself is unverifiable from these transcripts — no uncompressed
  baseline sessions to compare against. It can only ever describe the prose slice.
- Clarity overhead observed: 8 of ~70 substantive user messages (~11%) spent
  overriding or clarifying the style — "Speak plainly…" (3,166 output tokens to
  answer), "In simple language explain…", "In succinct and plain language explain…",
  "What does 'buy decision' mean?", "Turn caveman off, write documentation … for
  humans", "Caveman off. Why did the screenshot fail?", and twice "Caveman off, and
  redo the review" — the expensive cases: the compressed review was paid for, then
  fully regenerated.

Conclusion: measured best-case saving (~2% of output tokens, ~0.5% of cost) is
smaller than measured overhead (~11% of turns on style overrides incl. two full
re-dos). Compression targets the one slice that is both tiny and the only part the
user actually reads.

## Assumptions

- ~~Caveman's savings are real and worth keeping for intermediate output~~ —
  REFUTED by measurement above; the docs/tools-and-process.md:172-176 65% claim
  needs correcting.
- ~~Clarification round trips happen often enough to matter (not yet measured)~~ —
  CONFIRMED: ~11% of substantive turns.
- The skills are user-global, so a fix lives in `~/.claude/skills/` or global CLAUDE.md, not
  this repo; this item tracks the decision and any measurement tooling, which may live here.
- Claude Code reliably honors a per-position style rule ("working updates compressed, final
  message clear") within one skill — plausible but unverified.

## Design decisions

- **Where clarity kicks in** — (A) final-message-only rule added to caveman's Auto-Clarity
  list vs (B) drop caveman default, invoke it only on demand / for subagents vs (C) keep
  caveman full everywhere, rely on `speak-plainly` on demand. Measurement settles this:
  B — the "working-output savings" A was designed to preserve measure at ~2% of output
  tokens best case, while overrides cost ~11% of turns. **B is the recommendation.**
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
1. **Drop the caveman default** (strongest, was #2): remove "Always respond in caveman full
   mode" from global CLAUDE.md. Replace with a clarity rule in the speak-plainly register
   ("succinct professional technical writer; selective, not compressed; no filler, no
   LLM boilerplate") so verbose LLM style does not return. Keep caveman available
   on-demand (/caveman) and for subagent reports (cavecrew), where compressed output
   shrinks tool results re-read into main context.
2. **Edit caveman Auto-Clarity** (was strongest, now fallback): add "final deliverable
   answer: caveman-lite minimum; multi-part wrap-ups use speak-plainly register". Only
   worth it if the user wants to keep the caveman default despite the numbers.
3. ~~Measure first~~ — done 2026-08-23 (Measurements section); script in session
   scratchpad, promote to `tools/` only if re-measurement becomes recurring.

Long term: token-efficiency effort belongs where the tokens are — tool results
(1.16M chars observed), tool-call arguments (185k est. tokens), thinking budget — not
prose style. Cavecrew's compressed subagent reports are the one caveman application
aimed at a slice that matters.

Also update docs/tools-and-process.md:172-176: replace the 65% claim with measured
numbers, and NOTES.md note that its token figures say nothing about caveman's effect.

Adjacent ideas worth their own item: clarification-round-trip counter as a metrics script
(only if measuring becomes recurring, not one-off).

## Bedrock

The measurement changed the seam. The invariant worth strengthening is now
**measure before adopting style/process interventions**: the 65% vendor claim survived
into docs/tools-and-process.md and daily use unexamined, and a one-evening transcript
scan refuted its relevance. The durable asset is the measurement method (transcript
composition scan + override count), not any style rule. Verdict: **simplest** — delete
one CLAUDE.md line, add one clarity line. Keep exactly one style-switching mechanism
(the global CLAUDE.md rule); the caveman skill stays untouched, available on demand.

## Done means

- [ ] Global CLAUDE.md no longer forces caveman; replacement clarity rule
      (technical-writer register, selective not compressed) in place.
- [ ] Caveman still invocable on demand and still used for cavecrew subagent reports.
- [ ] docs/tools-and-process.md caveman paragraph replaced with measured numbers
      (ceiling ~3% of output tokens; ~11% of turns spent on overrides).
- [ ] A week of sessions shows no "caveman off" / "speak plainly" style-override turns.

## Simplest possible implementation

In global CLAUDE.md, replace "Always respond in caveman full mode. Follow skill:
caveman." with: "Write like a succinct professional technical writer: plain prose,
minimal jargon, selective rather than compressed. No filler, no LLM boilerplate.
Caveman only when I invoke it." Nothing else changes.

Pros:
- Deletes the measured ~11%-of-turns override cost at its source; reversible instantly.
- Gives up only ~2% of output tokens (~0.5% of cost) — the measured best case.
- No skill surgery; caveman and cavecrew keep working on demand.

Cons:
- Replacement register untested as an always-on default — could drift back toward
  verbose LLM style; watch first week of sessions (Done means #4).
- docs/tools-and-process.md and NOTES.md still carry the 65% framing until updated.
- Chars/4 estimate is rough and thinking/tool-call slices unverifiable from prose;
  ceiling conclusion is robust to this, but exact percentages are estimates.
