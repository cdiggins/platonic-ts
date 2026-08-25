---
id: BL-0035
title: Add a fresh-context code review agent with a bounded scope
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-25
closed:
links: [BL-0033, BL-0034, docs/claude-code-integration-2026-08-22.md, docs/post-coding-questions-2026-08-23.md, .claude/agents/architect.md, .claude/agents/scout.md, .claude/skills/start-work/SKILL.md, .claude/skills/track-issue/SKILL.md, packages/check/src/run.ts]
---

## Idea

A code review agent for this repository: a subagent spawned with no memory of the session that
wrote the code, handed a diff, returning correctness findings and nothing else. Inspired by the
`requesting-code-review` skill in `pcvelz/superpowers` (the framework already catalogued in
[BL-0033](BL-0033-assess-vs-superpowers.md)), but shaped to this repo's constraint that
mechanical checks belong to `npm run check` rather than to a reading agent.

Three requirements came with the request and they are what make this item non-trivial:

1. **It must not take long.** A review that reads the repository before reporting costs more
   than the change it reviews.
2. **It must not get caught on irrelevant details.** Style, formatting, naming conventions,
   escape-hatch counts, and doc-block freshness are already decided by `npm run check` and
   `docs/style-guide.md`. A reviewer that reports them is spending the user's attention on
   settled questions.
3. **It must run on a fresh agent.** Not a review pass inside the implementing session — a
   subagent that has not seen the plan, so it reconstructs intent from the code.

The fourth requirement — "log issues for bigger items" — is the disposal rule from
[post-coding-questions-2026-08-23.md](../docs/post-coding-questions-2026-08-23.md) section 2
restated: a finding that will not change this diff must leave the session as a `backlog/` item
or leave the session entirely.

## Assumptions

- The reviewer's value comes from the context it lacks, not from the tools it has. This is the
  isolation rationale already written down in
  [claude-code-integration-2026-08-22.md](../docs/claude-code-integration-2026-08-22.md)
  section 5: "runs with fresh context precisely so it has not seen the implementation session's
  reasoning."
- The gate is trusted. If `npm run check` is green, the reviewer may assume types, lint, the
  escape-hatch ratchet, tests, backlog ids, import boundaries, and `INDEX.md` freshness are all
  settled (`packages/check/src/run.ts`). Every one of those is a category of "irrelevant detail"
  the reviewer can be told to skip, by name.
- The prompt that does this already exists and is in the wrong place.
  `.claude/skills/start-work/SKILL.md:185` carries a "Fresh-context reviewer prompt" — two
  passes, correctness and duplication, style nits omitted — pasted inline as text for the
  supervisor to copy. It has never been an agent, so nothing else can invoke it and no other
  skill shares it.
- Filing an item is not free and not idempotent. Ids come from `npm run backlog:next-id`, which
  allocates a marker under `backlog/.ids/`; an agent that files eagerly creates items nobody
  asked for and ids that cannot be reused.
- Claude Code ships its own `/code-review` skill. Anything built here must be worth more than
  that generic reviewer, or the right answer is to use the built-in one and file nothing.

## Design decisions

- **Agent vs. skill vs. both.** `.claude/agents/reviewer.md` (a spawnable agent with a
  restricted tool grant, following `scout.md` and `architect.md`) versus
  `.claude/skills/code-review/SKILL.md` (a `/`-invocable command). The agent is what gives fresh
  context; the skill is what makes it reachable by typing. The precedent in this repo is
  `architect` — an agent, invoked by name from `start-work`, with
  [BL-0034](BL-0034-architecture-opportunities-command.md) proposing a thin skill wrapper over
  it. Following that precedent means agent first, skill only if the user wants to invoke it
  standing.
- **What bounds the run — this is the whole "don't take too long" requirement.** Candidate
  limits, which must be chosen deliberately rather than left to the model: scope fixed to the
  diff (never "review the package"); a named tool budget after which it reports what it has; a
  severity floor below which findings are dropped rather than listed; and a fixed pass list so
  it cannot invent a third thing to look at. The start-work prompt already fixes the pass list
  at two (correctness, duplication/reuse) — the open question is whether that is the right two.
- **How "irrelevant" is defined.** Two ways to say it. Negative: enumerate the gate's checks and
  forbid reporting any of them. Positive: enumerate what a review is for — does the code do what
  the change claims, where does it break, does it re-implement something that exists. The
  negative list is precise but goes stale when `packages/check/src/run.ts` gains a step; the
  positive list survives but leaks. Probably both, with the negative list pointing at the gate
  rather than copying its contents.
- **Who files the issues.** The reviewer files them itself (needs `Bash` for the allocator plus
  `Write`, and it will file eagerly), versus the reviewer returns structured findings and the
  calling session routes each through `/track-issue` after the user says which ones. The second
  keeps the reviewer read-only like `scout`, keeps id allocation in one session, and puts a
  human decision between "an agent thought this" and "the backlog now says this". Cost: the
  finding has to survive the hand-back, so its shape must be fixed.
- **Whether the reviewer runs the gate.** If it does, a review of a broken tree wastes its
  budget reporting failures the author already saw. If it does not, it may report a bug the
  typechecker would have caught. Likely: require green before the review is worth spawning, and
  say so as a precondition rather than a step.
- **What "the diff" means when nothing is committed.** `git diff`, `git diff --staged`, a commit
  range, or the paths a wave touched. `parallel-wave` and `start-work` know the paths; a
  standing invocation does not. The default has to be decided or every caller invents one.

## Related

- [BL-0033](BL-0033-assess-vs-superpowers.md) — catalogues `pcvelz/superpowers`, including its
  `requesting-code-review` and `verification-before-completion` skills. This item adopts one
  idea from that framework ahead of the full assessment; the assessment should note it was taken
  early.
- [BL-0034](BL-0034-architecture-opportunities-command.md) — the sibling shape: a standing
  review, but structural and repo-wide rather than diff-scoped. Same routing question (findings
  terminate in `backlog/`), same agent-plus-thin-skill decision. Whichever lands first should
  settle the finding shape for both.
- `.claude/skills/start-work/SKILL.md:185` — the prompt this item promotes to an agent. If the
  agent lands, that section must be replaced by an invocation, not left as a second copy.
- `.claude/agents/architect.md` mode 2 — an existing after-the-fact reviewer, but of *placement
  and coherence*, not correctness. The boundary between the two agents needs stating so they do
  not both grow into general reviewers.
- `.claude/agents/scout.md` — the read-only agent pattern this one should follow if it does not
  file items itself.
- [docs/post-coding-questions-2026-08-23.md](../docs/post-coding-questions-2026-08-23.md) —
  sorts post-change questions by who can answer them and what the answer may cost. Its phase
  split and its disposal rule are the specification for this agent's prompt; the item should not
  re-derive them.
- `packages/check/src/run.ts` — the authoritative list of what the gate already decides, and
  therefore of what the reviewer must not report.

## Approaches

Short term:

1. `.claude/agents/reviewer.md` — move the start-work prompt into an agent definition, add the
   explicit skip list (anything `npm run check` decides), a fixed two-pass structure, and a
   read-only tool grant (`Read`, `Grep`, `Glob`, read-only `Bash` for `git diff`, plus the
   `platonic` search/usages tools so the duplication pass can check before claiming). Replace
   the inline prompt in `start-work` with a spawn. One new file, one edited.
2. Add the finding contract: each finding is `file:line`, one-sentence claim, severity, and a
   disposal — fix now, or file it. The calling session files the "file it" ones through
   `/track-issue`. No new code; it is a shape the prompt demands and the caller honours.
3. Add `.claude/skills/code-review/SKILL.md` only once the agent has been used a few times and
   the default diff scope is known from practice.

Long term: give the reviewer numbers before it reads. `symbol_diff`, `blast_radius`, and
`tests_for_symbol` over MCP can tell it which changed symbols have no covering test and which
have the widest reach, so its budget goes to the risky half of the diff instead of the top half.
That is also the path to making review cost proportional to blast radius rather than to line
count.

Adjacent ideas worth their own item:

- A mutation check for the "did the gate exercise this change" question in
  post-coding-questions section 3 — break the change on purpose, confirm something turns red.
- Model-tier routing for subagents (already listed as a spin-off under BL-0033); a bounded
  reviewer is the obvious first consumer.

## Bedrock

The seam this strengthens is the split stated in
[claude-code-integration-2026-08-22.md](../docs/claude-code-integration-2026-08-22.md)
section 7 — mechanical properties are the gate's, and only "the genuinely uncheckable residue"
goes to an agent. A review agent is the sharpest test of that split, because a reviewer with no
stated skip list drifts straight back into reporting what the gate already reports. Writing the
skip list as a pointer to `packages/check/src/run.ts` makes the split load-bearing in a second
place: add a check to the gate and the reviewer's territory shrinks automatically.

The second thing it strengthens is single-definition-per-prompt. The reviewer prompt exists
today as inline text inside one skill, which means it cannot be invoked, cannot be improved in
one place, and is already at risk of being copied into `parallel-wave`. Promoting it to
`.claude/agents/reviewer.md` gives every caller — `start-work`, a wave supervisor, the user
directly — one definition, the same way `architect` and `scout` already work.

Verdict: **simplest-along-the-grain**.

The simple version — one agent file, one edit to `start-work` — must NOT:

- give the reviewer write access to `backlog/` or to source; findings come back as data and the
  calling session files them, or the fresh-context guarantee buys nothing and ids leak;
- copy the gate's checks into the agent prompt; point at `packages/check/src/run.ts` instead;
- become a step in `npm run check`; the gate reports and never judges;
- absorb architectural judgement — that is `architect` mode 2, and a reviewer that also rules on
  placement is two agents in one file with no way to bound either.

## Done means

- [ ] `.claude/agents/reviewer.md` exists, is read-only, and states its scope as a diff plus a
      fixed pass list.
- [ ] The agent prompt names an explicit stop rule (scope, budget, severity floor) so a run
      terminates without the caller interrupting it.
- [ ] Findings come back in a fixed shape carrying `file:line`, severity, and a disposal, and
      the calling session files every "file it" finding through `/track-issue`.
- [ ] `.claude/skills/start-work/SKILL.md` invokes the agent instead of carrying a copy of the
      prompt.
- [ ] On a diff whose gate is green, a run reports zero findings drawn from anything
      `packages/check/src/run.ts` already checks.

## Simplest possible implementation

Create `.claude/agents/reviewer.md` in the shape of `.claude/agents/scout.md`: frontmatter with
a read-only tool grant, a body that takes a diff, runs two passes (correctness against the
stated acceptance criteria, then duplication against what the repo already has), forbids
everything the gate decides, caps itself at a stated number of tool calls, and returns findings
most-severe-first with a per-finding disposal. Replace the pasted prompt at
`.claude/skills/start-work/SKILL.md:185` with a spawn of that agent. Two files, no TypeScript,
no new package.

What you get:

- Works the day it lands; nothing to maintain beyond prose.
- The fresh-context guarantee is structural rather than a promise the supervisor keeps.
- One definition, so improvements to the prompt reach every caller.
- Reversible by deleting one file and restoring one section.

What you give up or risk:

- Nothing enforces the budget or the skip list — both are instructions to a model, and a verbose
  reviewer is exactly the failure this item exists to prevent. The first few runs are the
  evidence for whether prose is enough.
- Findings are unstructured text across the agent boundary, so the calling session has to read
  them to route them; a wave with several tracks cannot aggregate reviews mechanically.
- The default diff scope stays unspecified until a caller other than `start-work` exists.
- Overlaps Claude Code's built-in `/code-review`; if the built-in reviewer with a short
  repo-specific preamble does the job, this item should close as declined rather than land.
