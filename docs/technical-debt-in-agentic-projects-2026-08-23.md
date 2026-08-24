# Technical Debt in Agent-Maintained Codebases

**Status:** essay.
**Date:** 2026-08-23
**Related:** [testing-gates-ratchets-goldens-2026-08-22.md](testing-gates-ratchets-goldens-2026-08-22.md)
(mechanical enforcement), [abstraction-timing-2026-08-23.md](abstraction-timing-2026-08-23.md)
(when duplication should become an abstraction).

---

## 1. The definition

Technical debt is anything that slows down future feature development.

That is the whole definition, and it is worth taking seriously, because it is both broader and
narrower than the usual ones.

It is broader because it is not limited to code. Missing documentation is debt if the next
feature requires rediscovering what the docs would have said. A slow test suite is debt because
every future change pays its runtime. A wrong abstraction is debt even when every line of it is
clean. An undocumented decision is debt the day someone has to re-litigate it.

It is narrower because it excludes things that merely offend. Ugly code in a module nothing will
ever touch again slows nothing down and is therefore not debt, however much it itches. A
suppressed type error in a dead corner costs less than the afternoon spent fixing it. The
definition forces the question "slower at what, for whom, when?" — and if there is no credible
answer, there is no debt, only distaste.

The definition also fixes the unit of account. Debt is measured in future velocity lost, so the
interest rate on any given debt is proportional to how often future work passes through it. Debt
on the main path compounds; debt in a leaf module sits at zero interest indefinitely.

---

## 2. The comparison that matters

The interesting comparison is not "agents versus a team." It is agents versus the best case:
a single highly skilled developer with a keen eye for software engineering, maintaining the
codebase alone.

That developer is a formidable baseline, and it is worth being precise about why.

**They carry the whole design in their head.** Every module's purpose, every decision's
rationale, every half-finished idea — resident in memory, retrieved for free. When they add a
feature, they know instantly which existing code should serve it, which invariant it threatens,
and which earlier shortcut is now due.

**Their taste is consistent over time.** The same person makes the naming decisions in month one
and month twelve, so the codebase converges toward one style instead of averaging several. A
reader who has understood one module has partially understood them all.

**They feel the interest payments directly.** When a past shortcut slows them down, they are the
one slowed. The feedback loop between incurring debt and paying it runs through a single nervous
system, which is the most effective debt-management mechanism ever discovered.

**They can time abstractions.** Knowing every occurrence of a pattern, and roughly what is coming
next, they can wait for the third use before abstracting — and actually notice the third use when
it arrives.

The empirical observation this essay starts from: codebases maintained by agents drift away from
this baseline. They become slower to work on — features take more effort to add, changes break
more things, and understanding decays faster than it is rebuilt. That drift is not an accident of
current model quality. It follows from structural differences in how agents work, and it will
persist in some form even as models improve, because the differences are about memory,
continuity, and incentives rather than intelligence.

---

## 3. Why the drift happens

Five mechanisms, each a direct inversion of one of the single developer's advantages.

**No memory between sessions.** An agent starts every session from the repository plus whatever
context it is handed. The design rationale, the mental map of what exists, the list of places
that need attention — all of it evaporates when the session ends. Whatever is not written into
the repository does not exist for the next session. The single developer's largest asset,
accumulated context, is exactly the thing agents structurally lack. The consequence for debt is
direct: knowledge debt, invisible and unpriced in human teams because people remember, becomes
the dominant debt category. Every undocumented decision is re-derived, at token cost and error
risk, on every session that touches it.

**Writing is cheaper than finding.** For a human, writing a helper costs more than searching for
an existing one, so reuse wins. For an agent, generating two hundred lines is nearly free while
searching a large unfamiliar codebase is slow and uncertain, so rewriting wins. The economics of
reuse are inverted, and the result is the signature debt of agent-maintained code: the same
function written several times under different names, none of them aware of the others. Each
copy is locally fine. Collectively they mean every future fix must be made N times, and usually
is made fewer.

**Optimizing the stated goal, not the real one.** An agent's objective is whatever check or
instruction it was given. The real goal — a codebase that stays fast to work on — is unstated
and unmeasured, so it receives no optimization pressure at all. Whatever the gates measure stays
bounded; everything else drifts. The single developer needs no such alignment because they *are*
the real goal's stakeholder: future velocity is their own future. An agent finishing a session
has no future in the codebase. This is the deepest of the five, because it means agent-maintained
code is only as healthy as its measurements, and no set of measurements captures "easy to change."

**Code arrives faster than understanding.** An agent produces in an hour what would take a person
a week, and no reviewer's comprehension scales with it. In single-developer work, writing and
understanding are the same act — the author's model of the system updates as the code lands.
In agentic work they decouple: the code exists, and nobody's model of the system includes it.
Debt identification has historically been a byproduct of comprehension ("while I was in there I
noticed…"); when comprehension stops keeping pace, debt stops being noticed, which is different
from and worse than debt not being fixed.

**Averaged taste, not consistent taste.** Every session is, in effect, a different author —
similar, but not the same, and steered by different immediate goals. Conventions drift.
Half-patterns accumulate: three error-handling styles, two naming schemes, an abstraction started
and abandoned. None of these is wrong in isolation; together they raise the cost of reading
everything. The single developer's convergence toward one style reverses into a slow divergence,
and reading cost is the tax every future feature pays first.

The compounding effect deserves its own sentence. For agents, the interest on technical debt is
paid in context: a confusing codebase consumes more of each session's limited attention just to
be understood, which leaves less for the actual work, which produces worse changes, which make
the codebase more confusing. Debt makes agents worse at exactly the work that would pay it down.
The spiral has a human analogue, but the human version turns over in months; the agent version
turns over in sessions.

---

## 4. What actually counteracts it

The countermeasures follow from the mechanisms. Each one is a prosthetic for something the single
developer got for free.

**Externalize the memory.** Since nothing survives a session unless written down, the writing has
to be treated as infrastructure, not paperwork: decisions and their rationale in docs, known
problems in a tracked backlog, costly discoveries in an append-only notes file. The test for
whether it is working is whether a fresh session, given only the repository, would avoid the
mistakes the last session made. This substitutes for the developer's memory — imperfectly,
because retrieval from files is worse than retrieval from a mind, which is why it must be
aggressive rather than tasteful about what gets recorded.

**Make the unstated goal stated.** If agents optimize what is measured, the only debts that stay
bounded are the counted ones. So the highest-leverage move in an agentic project is not fixing
any particular debt; it is expanding the set of debts a machine counts and a gate enforces.
Escape hatches, undocumented exports, file size, duplication, unused code — each one moved from
"noticed occasionally" to "counted always" is a category that stops drifting. This substitutes
for the developer's stake in the outcome: the gate feels the interest payments the agent cannot.

**Ratchet, never target.** A ratchet says "never worse" and lets improvement happen wherever it
is cheap. A target ("zero by Friday") invites the shortest path to the number, and agents find
shortest paths faster than people do — including the degenerate ones, like deleting the thing
being measured. Ratchets also solve the timing problem: debt gets paid incrementally, adjacent to
other work, which is when the information needed to pay it well is freshest.

**Make reuse cheaper than rewriting.** The duplication mechanism is economic, so the fix is
economic: invest in search, indexing, and code-navigation tooling until finding the existing
helper genuinely costs less than writing a new one. A codebase map an agent can query beats a
convention an agent is asked to follow. Where duplication has already happened, detect it
mechanically — text-level review will not see two implementations that share no lines.

**Distrust the instruments.** All of the above routes trust into measurement code, and
measurement code is code: it has bugs, and its characteristic bug — silent under-counting — is
invisible by construction, because a gate that wrongly says "ok" looks identical to a healthy
one. Instruments need their own tests, ideally differential ones against an independent
implementation. And an agent that changes an instrument must not be the one that re-blesses the
baseline the instrument checks, because a scanner that sees less is indistinguishable from a
codebase that improved.

---

## 5. What has no substitute yet

Honesty requires listing what the countermeasures do not cover.

**Design coherence.** Gates keep individual debts bounded; nothing keeps the overall design
convergent. A hundred sessions each passing every check can still produce a system whose parts
do not compose, because "the parts compose" was never a check. The single developer's unified
vision has no mechanical replacement. The nearest available substitute is a human who reviews at
the architecture level on a slower cadence than the code changes — which reintroduces the human
bottleneck, at a higher altitude where it is affordable.

**Abstraction timing.** Knowing when duplication should become an abstraction requires knowing
what is coming next, which requires continuity nobody in an agentic project has. Rules of thumb
help; none replaces the judgment.

**Knowing what not to build.** The skilled developer's most valuable refusals — the feature not
added, the dependency not taken, the generalization not made — leave no trace for a gate to
protect. Agents, biased toward producing something, need the refusals made explicit as scope
statements, and even then the pressure is one-directional.

The summary position: an agent-maintained codebase left to its defaults drifts toward slower
development, and the drift is structural, not incidental. It can be held off — but only by
externalized memory, mechanical measurement, and economic tooling that together stand in for the
memory, stake, and taste a single skilled developer carries natively. Where no stand-in exists
yet, the honest move is to name the gap and keep a human in it.
