# Platonic TypeScript

An opinionated approach to writing [TypeScript](https://www.typescriptlang.org/) for humans and coding agents.

Built for one person working with coding agents — Claude Code first, other agents where practical — in a single repository, iterating fast. Generalizing to multiple repositories is a later ambition; team workflows are out of scope.

## Status

Early prototype. Started August 22nd, 2026. Implemented so far: an npm-workspaces
monorepo (`packages/core`, `transcripts`, `backlog`, `dashboard`, `check`) built by parallel
fenced agent waves (process in [CONTRACTS.md](CONTRACTS.md), findings in [NOTES.md](NOTES.md)),
a functional-subset ESLint configuration, and a live agent-observability dashboard
(`npm run dashboard`, port 4747) that tails Claude Code session transcripts to show agents,
models, token rates, the backlog (`backlog/`), and documents in real time. The dashboard covers
agent activity and logged work only; browsing and scoring the source code is a separate tool's
job, and the boundary is explained in
[Tools, Skills, and Process](docs/tools-and-process.md#scope-what-the-dashboard-is-not). The [Documents](#documents) section indexes
the design notes. The tools, skills, and multi-agent process are documented for humans in
[Tools, Skills, and Process](docs/tools-and-process.md). The backlog now follows the
[WorkQuarry](https://github.com/ara3d/workquarry) issue-tracking schema, implemented natively
in TypeScript — see the [adoption ADR](decisions/2026-08-22-adopt-workquarry-format.md).

## Motivation 

The goal of this project is to use coding agents (e.g. Claude Code, Cursor) to:

1. finish coding tasks faster - with higher confidence of the quality
2. consume the same or fewer tokens for comparable quality work output 

A number of sub-goals fall from this:

* increase agentic accuracy (correct on the first attempt, without rework)
* rely more on automated tools, less on agents
* make it easier for multiple agents to work together

## First Deliverable

A single command, `platonic check`: strict compiler settings, a functional-subset lint configuration, and an escape-hatch ratchet (committed counts of `any`, `as`, `!`, `@ts-ignore`, and `eslint-disable` that may fall but never rise) behind one entry point. One command, one definition of green. The candidate list and the reasoning behind this choice are in [Deliverable Ideas](docs/deliverable-ideas-2026-08-22.md); the build order is in the [framework notes](docs/agent-development-framework-2026-08-18.md).

## Hypotheses 

These drive the design. None is treated as settled; each should eventually be confirmed or refuted by measurement (see Challenges).

### Strong hypotheses

Well supported by evidence, mechanics, or broad experience.

* H1. Generally speaking projects start fast, and slow down as features are added
* H2. As features are added files get bigger, and more coupled
* H3. As files get bigger, edits become more expensive, and more prone to error
* H4. Large files, coupled concerns, and mutable state make agentic parallelism harder
* H5. Mutable state is harder to reason about
* H6. Pure functional code is easier to reason about (both examined in the [pure FP report](docs/pure-fp-for-agents-2026-08-22.md))
* H7. Agents are more effective when code is discoverable, and grouped by concern
* H8. Documentation and code can get out of sync, causing confusion
* H9. Agents have a tendency to store historical records, or reference missing/irrelevant context in comments
* H10. Agents can be overly verbose
* H11. It is hard to measure the impact of different tools/approaches

### Weak hypotheses

Anecdotal, contested, or dependent on conditions not yet established. H12 and H14–H19 are examined against the published record in [Evidence for the Unexplored Weak Hypotheses](docs/weak-hypotheses-evidence-2026-08-22.md).

* H12. When code is pure functional, tests don't have to be rerun each time (purity alone is not enough — this needs content-addressed caching of results, which Unison demonstrates is feasible)
* H13. TDD is too strict of a framework in some cases (examined in [TDD for Agent-Driven Development](docs/tdd-for-agents-2026-08-22.md))
* H14. Tools and approaches age quickly as models become more capable and less error-prone — prompt-heavy scaffolding from even a year ago (e.g. 2025) is often obsolete, though the underlying toolchains are not
* H15. Agents need flexibility to backtrack as they work
* H16. Forcing an agent to explain itself to me in simple language can cause it to think more clearly, and reevaluate its recommendations
* H17. Asking lots of questions of an agent seems to help it better plan, and execute on work
* H18. Providing simple prioritized principles for decision making in plain language is very effective
* H19. Overly precise or strict rules and enforcement can sometimes slow things down (e.g., agent loops trying to reach a specific word count)

## Approach 

* Keep code small
* Prefer pure functional code whenever possible
* Create libraries when they can make a problem easier to solve
* Always consider the simplest thing that could possibly work
* Weigh the options, and track the decision-making process  
* Allow sub-agents spawning when appropriate
* Use tools where possible instead of agents - to identify and fix problems
* Prefer static analysis over run-time evidence
* Code that is reused by multiple code paths is more reliable
* Succinct code is better than the same thing in long form 
* Commit and push frequently (when work starts, when a milestone is reached, but only when safe/clean)
* Don't use Git work trees or branch (doesn't help multiple agents)
* Track work being done by one agent, so other agents wait, and agents can recover
* Emphasize a data flow approach
* Only document what needs to be documented
* Use auto-created indexes to help agents/people orient themselves
* Delete tests when not necessary anymore
* Only run the tests required  
* Allow agents to generate and track ideas
* Use agents of appropriate strength
* Manage context appropriately
* Keep skill/prompt/tool usage simple
* Delete / retire unneeded code
* Code is the formal specification of behavior
* Avoid repetition
* Write code, rather than prose, wherever code can carry the intent
* Expressions over statements
* Perform spikes and investigations early as required, as explicit tests.
  
## Principles 

1. Correctness - proofs and static analysis trumps tests
1. Reusable - without having to change internals 
1. Robust - impossible, or at least, hard to use incorrectly. 
1. Fail fast - detect and report problems at the earliest point, as close to the cause as possible
1. Clarity - of intent, for programmers familiar with language. 
1. Brevity - without sacrificing clarity 

## Coding Best Practices

- DRY - Don't repeat yourself
- KISS - Keep it super simple
- Always first consider "The simplest thing that could possibly work" and accept and reject
- Document what options were considered and chosen 
- Write code (functions/types/libraries) so that it can be easily adapted and reused in other contexts - with minimal change
- Expressions over procedures
- Data transformation 
- Functions signature, type declarations, and interfaces - require more clarity and care than implementations. 
- Conservative in what it produces, liberal in what it accepts (Postel's law)
- Don't test what is already known or proven.

## Challenges

* Continuous improvement - making sure agents, tools, process, get better over time
* Measurement - moving from anecdote to evidence, effectiveness of agents/process, quality of code
* Prioritization - Making sure agents prioritize tasks and work appropriately 
* Goal alignment - between the human sponsor and the agents
* Observability - making it obvious to a human (as well as supervising agent) the status of work, things that are working well. 

## Prior Art and Related Work

* [Platonic.CSharp](https://github.com/cdiggins/Platonic.CSharp) — the sibling project this one builds on: a pure functional C# subset enforced by Roslyn analyzers, where the build itself is the enforcement. TypeScript splits that job between `tsc` and ESLint, which is why a single `check` script matters here.
* [eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional) — implements most of the functional subset off the shelf (immutability, no classes, no throw, no expression statements). Foundation, not competition.
* [Superpowers](https://github.com/obra/superpowers) — the most widely used agent development methodology, enforcing process (strict TDD, brainstorm-plan-implement) through prompt discipline. This project makes the opposite bet: enforce correctness through tools, and let process float. Compared in the [TDD report](docs/tdd-for-agents-2026-08-22.md).
* [Unison](https://www.unison-lang.org/) — content-addressed pure code with cached test results; prior art for never rerunning tests on unchanged pure functions.
* [AGENTS.md](https://agents.md/) — the emerging convention for agent-facing repository documentation; the portability layer once this project extends beyond Claude Code.
* [eslint-config-agent](https://github.com/tupe12334/eslint-config-agent) — a lint configuration tuned for AI-assisted development; narrower in scope (lint only, no subset, gating, or measurement).

## Documents

Early design notes. Everything here is a first draft, and nothing is implemented yet.

* [Tools, Skills, and Process](docs/tools-and-process.md) — human-facing guide to the check gate, the dashboard, the backlog, the Claude Code skills in use, and the fenced parallel-wave process. (Implemented — unlike the design notes below.)
* [An Agent Development Framework for TypeScript](docs/agent-development-framework-2026-08-18.md) — where this could go: a restricted TypeScript subset, rules moved out of prompts and into tools, and a gate that runs continuously so feedback is fast and small.
* [Off-the-Shelf Tooling Catalogue](docs/tooling-catalog.md) — candidate tools and libraries by job to be done, with overlaps flagged and a ten-item shortlist.
* [Deliverable Ideas](docs/deliverable-ideas-2026-08-22.md) — candidate deliverables grouped by build/adopt/package/link, converging on a recommendation.
* [Project Anatomy](docs/project-anatomy-2026-08-22.md) — the parts of a TypeScript project broken down finely, and the axes (truth/derived, checked/unchecked, durable/ephemeral, interface/interior) that determine how each part is maintained.
* [Git Worktrees and Branches for Concurrent Coding Agents](docs/worktrees-and-branches-for-agents-2026-08-22.md) — evaluates the no-worktrees stance; concludes shared tree by default, worktrees for spikes and background agents, with a decision rule and revisit conditions.
* [TDD for Agent-Driven Development](docs/tdd-for-agents-2026-08-22.md) — the evidence on TDD by the book and in practice, what changes with agents, a comparison with Superpowers, and a testing policy proposal.
* [Evidence for the Unexplored Weak Hypotheses](docs/weak-hypotheses-evidence-2026-08-22.md) — the published record for and against H12 and H14–H19, with a verdict and design implication for each.
* [Pure Functional Programming for Agent-Driven Development](docs/pure-fp-for-agents-2026-08-22.md) — the pros and cons of pure FP with agents; concludes for a pure functional subset of TypeScript, against pure FP languages and heavy monadic abstraction.
* [Testing, Gates, Ratchets, and Goldens](docs/testing-gates-ratchets-goldens-2026-08-22.md) — a taxonomy of mechanical enforcement: what each mechanism claims, when it checks, which direction change may move, and who may bless a change to the claim itself.
* [Claude Code Integration](docs/claude-code-integration-2026-08-22.md) — which hooks, MCP tools, skills, and agents make sense, placed by one rule: checkable rules become hooks, questions become MCP tools, only the uncheckable residue becomes skills.

## History

This project was started on August 22nd, 2026 by Christopher Diggins, released under the MIT License. 
It built upon prior work in [Platonic.CSharp](https://github.com/cdiggins/Platonic.CSharp). 
