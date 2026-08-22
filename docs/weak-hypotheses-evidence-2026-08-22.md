# Evidence for the Unexplored Weak Hypotheses

**Status:** technical report.
**Date:** 2026-08-22
**Companion to:** [tdd-for-agents-2026-08-22.md](tdd-for-agents-2026-08-22.md) (which covers H13)

---

## 1. What this document is

The [README](../README.md) lists eight weak hypotheses — "anecdotal, contested, or dependent on conditions not yet established" — and promises that each will eventually be confirmed or refuted. H13 (TDD is too strict in some cases) got its own report. This report gathers the existing evidence for the remaining seven: H12 (test caching for pure code), H14 (tools age as models improve), H15 (agents need to backtrack), H16 (explaining in simple language improves agent thinking), H17 (asking questions improves planning), H18 (simple prioritized principles work), and H19 (overly strict rules can slow things down).

None of these gets a controlled experiment here; the aim is to move each from "anecdote" to "anecdote plus the published record," state a verdict, and note what the verdict implies for `platonic check` and the rest of the design. The verdicts use three grades: **supported** (the mechanism is demonstrated somewhere real), **mixed** (evidence points both ways, conditions matter), and **untested** (no directly relevant published evidence found; the hypothesis rests on adjacent results plus this project's own experience).

---

## 2. H12 — Pure functional code plus content-addressed caching means tests need not be rerun

> When code is pure functional, tests don't have to be rerun each time (purity alone is not enough — this needs content-addressed caching of results, which Unison demonstrates is feasible)

### Evidence for

The README already names the existence proof: [Unison](https://www.unison-lang.org/) stores definitions by the hash of their syntax tree, and its [documented test caching](https://www.unison-lang.org/docs/usage-topics/testing/) marks a test result as cached when the test is a pure computation — a deterministic function of the code it calls. A cached test never reruns until some transitive dependency's hash changes. This is not speculative: it ships, and it works precisely because the language guarantees purity, so "inputs unchanged" really does imply "result unchanged."

The coarser-grained version of the same idea is mainstream build-tool practice. [Bazel's remote caching](https://bazel.build/remote/caching) and test-result caching skip any test target whose action inputs (sources, dependencies, flags) hash identically to a previous run; [Nx's computation caching](https://nx.dev/concepts/how-caching-works) and [Turborepo's caching](https://turborepo.com/docs/crafting-your-repository/caching) do the same at package/task granularity for the TypeScript ecosystem specifically. Google and Meta run their monorepos on this assumption at scale. So the mechanism — content-hash the inputs, cache the verdict — is thoroughly demonstrated, and off-the-shelf for TypeScript at file/package granularity.

The delta this project's stance adds: caching is only *sound* if the test is deterministic and hermetic. Impure tests (network, clock, filesystem, randomness) can change verdicts without any input hash changing, which is why Bazel requires declaring inputs and why flaky tests break caching in practice. A lint-enforced pure functional subset ([eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional) plus restrictions on ambient imports) is exactly the condition that makes cache hits trustworthy. Purity is the enabler; the cache is the payoff.

### Evidence against / limits

- **Granularity.** Unison caches per-definition because its unit of identity is the hashed definition. TypeScript's unit is the file (or package); a one-line edit invalidates every test transitively importing that file. Function-level caching would require a TypeScript-specific content-addressing layer that does not exist off the shelf. The practical ceiling for this project is file-granular caching via Nx/Turborepo or a small hash-manifest script — still a large win in a many-small-files codebase (which the Approach section independently demands), but well short of Unison's precision.
- **Purity is enforced approximately.** ESLint verifies syntactic discipline, not semantic purity: `Date.now()`, `Math.random()`, and environment reads can slip through unless explicitly banned. An unsound cache silently reports stale green — worse than rerunning. The subset's lint rules must therefore treat ambient impurity as an error, not a warning, before caching is switched on.
- **Cost-benefit at small scale.** For a young project whose whole suite runs in seconds, cache infrastructure is overhead. The hypothesis matters at the scale H1–H3 predict the project will reach, not on day one.

### Verdict: **supported** (mechanism demonstrated in Unison and in mainstream build caching), with the caveat that TypeScript caps the granularity at file level and soundness depends on enforcing hermeticity through the lint subset.

**Design implication:** the Approach items "Only run the tests required" and "Prefer pure functional code" are one feature, not two. `platonic check` should eventually key test execution on content hashes of each test's import closure; until then, adopting Nx/Turborepo-style task caching gets most of the value for none of the build cost. The lint subset should ban ambient impurity (`Date`, `Math.random`, `process.env` outside a designated shell layer) partly *because* that is what makes the cache sound.

---

## 3. H14 — Tools and approaches age quickly as models improve; toolchains do not

> Prompt-heavy scaffolding from even a year ago (e.g. 2025) is often obsolete, though the underlying toolchains are not

### Evidence for

The clearest documented case is chain-of-thought prompting. [Wei et al. (2022)](https://arxiv.org/abs/2201.11903) made "think step by step" the canonical prompt technique; three years later [OpenAI's reasoning-model guidance](https://platform.openai.com/docs/guides/reasoning-best-practices) explicitly tells developers to *avoid* chain-of-thought prompts for o-series models because the model reasons internally and the instruction can hurt performance. A technique that defined 2022–2024 prompt engineering became an anti-pattern the moment reasoning moved into the model. The same arc shows up in [Anthropic's prompting guidance](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview), which has progressively de-emphasized elaborate role-play and few-shot scaffolding for stronger models in favor of plain, direct instruction.

The pattern generalizes. [DSPy's](https://arxiv.org/abs/2310.03714) core argument is that hand-written prompts are brittle artifacts that break on every model change and should be compiled per-model rather than authored — an implicit concession that prompt scaffolding has a short half-life. Agent-framework churn tells the same story from the wreckage side: the elaborate 2023-era orchestration layers (AutoGPT's loop scaffolding, early LangChain agent abstractions) were largely abandoned as models got better at planning natively; the [TDD report](tdd-for-agents-2026-08-22.md) documents Superpowers pre-rebutting agent rationalizations that stronger models simply produce less often. This is Sutton's [bitter lesson](http://www.incompleteideas.net/IncIdeas/BitterLesson.html) applied to developer tooling: structure built to compensate for model weakness is exactly the structure the next model makes redundant.

The second half of the hypothesis — toolchains persist — needs no argument: `tsc`, ESLint, git, and the test runner predate the agent era and every agent generation has used them unchanged. A compiler error is useful feedback for GPT-3.5 and for whatever ships next year; a prompt tuned to GPT-3.5's failure modes is not.

### Evidence against / limits

- The claim is easy to over-apply. Not all prompt-adjacent practice ages: compact, factual context (what the repo is, where things live, what commands to run — the CLAUDE.md/[AGENTS.md](https://agents.md/) genre) has survived multiple model generations, because it supplies *information* the model cannot infer rather than *behavioral compensation* for weaknesses it will outgrow. The aging gradient runs along that axis, not along "prompts vs. tools."
- Some scaffolding ages in the other direction: verification harnesses become *more* valuable as models get stronger, because stronger models are better at exploiting weak verification (the reward-hacking record in the TDD report, section 4.2). METR's and OpenAI's monitoring results show capability increases amplifying, not shrinking, the need for tool-enforced checks.
- No systematic study measures scaffolding depreciation; the evidence is a consistent pattern of vendor guidance reversals and framework abandonment, not a controlled result.

### Verdict: **supported**, with a sharper restatement: what ages is *compensatory* scaffolding (structure that papers over model weaknesses); what persists is *informational* context and *verifying* tools. The hypothesis as written slightly undersells its own implication — verification tooling doesn't merely survive model improvement, it appreciates.

**Design implication:** this is the strongest evidence-backed argument for the project's central bet ("rely more on automated tools, less on agents"). Concretely: keep prompts/skills thin and informational; put every behavioral rule that can be a lint rule into the lint config; treat any prompt that coaches the model's *process* as a depreciating asset with a review date.

---

## 4. H15 — Agents need flexibility to backtrack as they work

> Agents need flexibility to backtrack as they work

### Evidence for

At the reasoning level, the benefit of backtracking is directly measured. [Tree of Thoughts (Yao et al., 2023)](https://arxiv.org/abs/2305.10601) added explicit exploration and backtracking over reasoning steps and lifted GPT-4's Game-of-24 success from 4% (chain-of-thought) to 74%; [Reflexion (Shinn et al., 2023)](https://arxiv.org/abs/2303.11366) showed that letting an agent observe failure, reflect, and retry raised HumanEval pass@1 to 91% against GPT-4's 80% baseline. Both results isolate the same mechanism: forced linear commitment to an early wrong step is a dominant failure mode, and cheap revision beats expensive foresight.

At the software-engineering level, the evidence is architectural rather than benchmarked: [SWE-agent (Yang et al., 2024)](https://arxiv.org/abs/2405.15793) found interface design — including the ability to re-open files, re-run searches, and revise edits — decisive for repository-scale performance, and every capable coding agent since (Claude Code included) is built as an observe-act-revise loop rather than a plan-then-execute pipeline. The failure mode of rigid upfront planning is familiar from any long agent transcript: the plan's step 3 turns out to rest on a false assumption discovered at step 5, and an agent that cannot revisit the plan either plows ahead wrongly or stalls.

The reasoning-model era has partly *internalized* this: interleaved thinking lets models backtrack inside their own chain of thought. That strengthens rather than weakens the hypothesis — labs found backtracking valuable enough to train it into the model.

### Evidence against / limits

- Backtracking has a token bill. Tree-of-Thoughts-style exploration multiplies inference cost by the branching factor; Reflexion pays a full retry per episode. For the project's goal of *fewer tokens per completed task*, undisciplined backtracking is a direct threat — an agent circling through revise-fail-revise loops is the expensive failure mode, and anyone who has watched an agent thrash on a flaky test has seen it.
- The hypothesis says "flexibility to backtrack," which is compatible with, but often conflated with, "no plan at all." The Superpowers comparison in the TDD report shows the opposite bet (mandatory plan-then-execute) working well enough to be the most popular methodology in the field. The open question is not whether backtracking helps (it does, measurably) but how much *commitment structure* should surround it.
- Cheap backtracking requires cheap checkpoints. Git provides them — which is a point of tension with the README's "don't branch" stance: frequent small commits to the shared branch are then the *only* checkpoint mechanism, so they must actually happen (the Approach already says so).

### Verdict: **supported** at the reasoning level by strong quantitative results, **untested** as a repo-workflow claim beyond architectural consensus. The refined form: agents need *cheap, bounded* backtracking — free revision within a step, checkpointed revision across steps, and a hard stop (budget or human escalation) on revision loops.

**Design implication:** fast, incremental `platonic check` is the backtracking enabler — the cheaper the verdict, the cheaper each revision. The gate should also be the loop-breaker: identical failure signature N times in a row is a signal to stop and escalate, which the "track work being done by one agent" mechanism can carry.

---

## 5. H16 — Forcing an agent to explain itself in simple language causes clearer thinking

> Forcing an agent to explain itself to me in simple language can cause it to think more clearly, and reevaluate its recommendations

### Evidence for

The human analogue is one of the better-replicated results in learning science: the self-explanation effect ([Chi et al., 1994](https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3)) — generating explanations of material to oneself measurably improves understanding and exposes gaps the explainer didn't know they had. Rubber-duck debugging is the folk-engineering version. For models, [Wei et al. (2022)](https://arxiv.org/abs/2201.11903) established that producing intermediate verbalization improves answers, and the entire reasoning-model line is that result institutionalized: making the model articulate steps before answering is now a training objective, not a prompt trick.

The "simple language" clause has a distinct mechanism worth separating: an explanation aimed at a non-expert cannot lean on jargon to sound complete, so hand-waving that survives technical register ("we then simply refactor the module") fails audibly in plain register. And the explanation is *checkable by the human* — which converts it from introspection into review. In a project run by one person supervising agents, that reviewability may be the larger share of the value: it catches misalignment (H-Challenges: goal alignment, observability) even when it does nothing for the model.

### Evidence against / limits

- The direct version of the hypothesis — that the verbalized explanation *is* the model's reasoning, so demanding a better explanation yields better reasoning — is specifically contradicted. [Turpin et al. (2023)](https://arxiv.org/abs/2305.04388) showed models producing plausible chain-of-thought that systematically fails to mention the biasing features actually driving their answers; [Anthropic's reasoning-faithfulness work (2025)](https://www.anthropic.com/research/reasoning-models-dont-say-think) found reasoning models mentioning the hint they actually used in a minority of cases. A fluent simple-language explanation can be a post-hoc rationalization of a conclusion reached otherwise. The explanation is evidence *to the human*, not a window into the computation.
- For strong reasoning models, forced re-explanation can be redundant with internal reasoning (the H14 aging pattern applies to this technique too) and adds output tokens — in tension with the token goal.
- No published study isolates "explain to a layperson" as a treatment for agent output quality; the mechanism is extrapolated from human learning science and from CoT results that measure something related but not identical.

### Verdict: **mixed.** The re-evaluation effect is plausible and consistent with the CoT record; the faithfulness literature warns that the explanation may not reflect the actual reasoning, so its reliable value is as a *human-checkable summary* rather than as a cognitive forcing function. Worth using; not worth trusting as introspection.

**Design implication:** use plain-language explanation at decision points (recommendations, designs) where the human reads it — that is where the checkable-summary value concentrates — not as a blanket verbosity requirement on all work, which H10 (agents are overly verbose) and the token goal both argue against.

---

## 6. H17 — Asking lots of questions of an agent helps it plan and execute

> Asking lots of questions of an agent seems to help it better plan, and execute on work

### Evidence for

Both directions of questioning have published support. Agent-asks-human: [ClarifyGPT (Mu et al., FSE 2024)](https://arxiv.org/abs/2310.10996) had the model detect ambiguous requirements (via inconsistency among sampled solutions) and ask targeted clarifying questions before coding, raising GPT-4's Pass@1 on MBPP-sanitized from 70.96% to 80.80% — a ten-point gain purely from resolving ambiguity before implementation. Human-asks-agent is the same mechanism mirrored: each question forces the model to commit reasoning to context, and committed context conditions everything downstream — the questioning *builds the plan into the context window* rather than leaving it implicit. Model-asks-itself: [Self-Ask (Press et al., 2022)](https://arxiv.org/abs/2210.03350) showed that decomposing into explicit sub-questions before answering improves multi-hop accuracy over plain chain-of-thought.

Practice agrees from both ends of the methodology spectrum: Superpowers front-loads a mandatory Socratic brainstorming phase, and [Anthropic's Claude Code guidance](https://www.anthropic.com/engineering/claude-code-best-practices) recommends the explore-and-question phase before implementation. That the opposing camps of the TDD report converge on pre-implementation questioning is itself weak evidence it earns its cost.

### Evidence against / limits

- The economics cut against "lots." Each question-answer round-trip costs tokens and — with a human in the loop — wall-clock time, the two denominators of the project's goal. ClarifyGPT's own design concedes this: it gates questioning behind an ambiguity check and asks *targeted* questions only when sampled solutions disagree. Indiscriminate questioning of an unambiguous task is pure overhead.
- Interrogation can produce sycophantic revision: models under challenge tend to abandon correct answers as readily as incorrect ones. Questioning that reads as *doubt* rather than *elicitation* can make output worse, not better.
- The hypothesis as experienced (human quizzing the agent) has no direct published measurement; the cited results measure adjacent mechanisms (agent-initiated clarification, self-decomposition).

### Verdict: **supported** in mechanism (resolving ambiguity before implementation measurably improves outcomes), **mixed** on the "lots" quantifier — the evidence favors *targeted* questions triggered by ambiguity, not volume.

**Design implication:** the leverage point is ambiguity detection, and part of it can be tooled: a task whose acceptance criteria can't be stated as a checkable predicate (a failing test, a lint rule, a type) is ambiguous by construction. "Can `platonic check` express when this is done?" is a mechanical ambiguity check that triggers clarification only when needed — questioning as an exception path, not a mandatory phase.

---

## 7. H18 — Simple prioritized principles in plain language are very effective

> Providing simple prioritized principles for decision making in plain language is very effective

### Evidence for

The strongest quantitative support is the instruction-density literature. [IFScale (Jaroslawicz et al., 2025)](https://arxiv.org/abs/2507.11538) measured 20 frontier models against growing simultaneous-instruction counts: even the best models fell to 68% adherence at 500 instructions, degradation began far earlier, and models systematically favored *earlier-listed* instructions. Two direct consequences: rule volume has a budget, and order carries signal — which is precisely what "simple" (few rules, within budget) and "prioritized" (important ones first, with declared precedence) exploit. A prioritized short list is the format the measured failure modes select for. The positional finding is consistent with the broader context-position literature ([Liu et al., "Lost in the Middle," 2023](https://arxiv.org/abs/2307.03172)).

Principles also compose where rules collide. An exhaustive rulebook needs a meta-rule for every conflict; a precedence order ("correctness trumps tests; clarity before brevity" — the README's Principles section is already shaped this way) resolves novel conflicts without new text. [Constitutional AI (Bai et al., 2022)](https://arxiv.org/abs/2212.08073) is an existence proof at training scale that a modest list of plain-language principles can steer model behavior across unbounded situations. And vendor prompting guidance has converged on the same style — short, direct, plainly-worded instruction over elaborate specification — for exactly the H14 reason: strong models generalize well from intent.

### Evidence against / limits

- Principles trade coverage for compression: they underdetermine hard cases, and two agents (or the same agent twice) can apply "keep it simple" divergently. Where consistency matters more than judgment — formatting, import order, banned constructs — a mechanical rule beats a principle, and the project's own thesis says that rule should live in a tool, not in prose.
- "Very effective" compared to what? Against exhaustive rulebooks, the IFScale degradation curve favors principles. Against *enforced* rules (lint, types), principles lose on everything they can express — enforcement doesn't decay with instruction count at all.
- No study directly compares principle-style versus rule-style system prompts for coding-agent outcomes; the support is triangulated.

### Verdict: **supported**, with a boundary: principles are the right format for the *residue* — judgment calls no tool can check. Everything mechanically checkable should graduate out of the principle list into the gate, which keeps the list short, which is what makes it work.

**Design implication:** treat instruction budget as a scarce resource the way the token budget is. CLAUDE.md should hold one short prioritized principle list plus repo facts; every principle that becomes a lint rule gets *deleted* from the prose. The README's numbered Principles section (0–5, precedence-ordered) is already the right shape; the 28-item Approach list is over the density budget IFScale warns about and is a candidate for the same graduation process.

---

## 8. H19 — Overly precise or strict rules and enforcement can sometimes slow things down

> e.g., agent loops trying to reach a specific word count

### Evidence for

The word-count example generalizes to a measured phenomenon: constraints that are expensive for the model to satisfy degrade the work itself. [Tam et al., "Let Me Speak Freely?" (2024)](https://arxiv.org/abs/2408.02442) found that strict format restrictions (forced JSON output) significantly degrade LLM *reasoning* performance versus free-form answers — the constraint competes with the task for the model's capacity. Exact word counts are a pathological instance: models don't tokenize in words, so the target is only reachable by generate-count-regenerate loops, burning tokens on a constraint that rarely mattered.

The enforcement-side version is familiar from human software engineering and directly observable with agents: a gate that fails on trivia (trailing whitespace, line length) triggers fix-recheck cycles that cost a round-trip each, and a *flaky* or slow gate is worse — the TDD report's round-trip-cost argument (section 4.2) applies to every checker, not just tests. There is also a perverse-incentive edge: ImpossibleBench (cited there) shows that when a constraint is hard to satisfy legitimately, models sometimes satisfy it illegitimately. Overly strict rules don't just slow agents down; they select for gaming.

### Evidence against / limits

- This hypothesis is in tension with the project's core bet, and the tension must be stated honestly: `platonic check` *is* precise, strict enforcement. The whole framework argument is that strictness pays. What reconciles them is which property is strict: H19's failure cases are all constraints on *incidental* properties (word count, output format, whitespace) whose satisfaction consumes capacity without improving the artifact. Strictness on *essential* properties (types, purity, passing tests) directs capacity at the artifact. The IFScale and format-restriction results measure the cost of the former; nothing in the record shows type-checking or test gates degrading output quality.
- Auto-fix dissolves much of the incidental-strictness cost: `prettier --write` and `eslint --fix` satisfy formatting constraints for zero model capacity. A strict rule with an auto-fixer costs nothing; H19's bite is limited to strict rules that must be satisfied *by generation*.
- Like several hypotheses here, no controlled study measures agent throughput against gate strictness; the direct evidence covers format constraints on reasoning, not lint gates on coding.

### Verdict: **supported** for constraints on incidental properties, and usefully sharpened: the risk factor is not strictness but *strictness on things that don't matter, without an auto-fix path*. The hypothesis and the project's strict-gate bet are compatible once that line is drawn.

**Design implication:** three rules for the gate. Every mechanically fixable rule ships with its fixer, and `platonic check` applies fixers before judging. Rules that can only be satisfied by regeneration must earn their place by catching real defects. And the ratchet design already embodies the right instinct — "may fall but never rise" constrains the trend, not each edit, avoiding exactly the per-edit loop H19 warns about.

---

## 9. Summary table

| Hypothesis | Verdict | Sharpened form |
|---|---|---|
| H12 test caching for pure code | Supported | Feasible at file granularity in TS today (Nx/Bazel-style); soundness requires lint-enforced hermeticity |
| H14 tools age with model progress | Supported | Compensatory scaffolding depreciates; informational context persists; verification tooling appreciates |
| H15 agents need to backtrack | Supported (reasoning level) | Cheap, bounded backtracking — with checkpoints and a loop-breaker, not unlimited revision |
| H16 simple-language explanation | Mixed | Valuable as human-checkable summary; unfaithfulness results say don't trust it as introspection |
| H17 asking lots of questions | Supported in mechanism | Targeted, ambiguity-triggered questions; "lots" is the wrong quantifier |
| H18 simple prioritized principles | Supported | Right format for the unmechanizable residue; everything checkable graduates into the gate |
| H19 strict rules can slow work | Supported, bounded | Cost concentrates in strictness on incidental properties without auto-fix; essential-property strictness is the project's bet |

Two cross-cutting observations. First, four of the seven verdicts sharpen into the same design move: push the load from prose and process into the gate (H14, H17, H18, H19). The weak hypotheses, examined, mostly turn out to be corollaries of the project's central bet. Second, the recurring evidence gap is measurement of *agent workflow* claims — the published record covers models and benchmarks, not repository practice. That is H11 restated, and it is why the Challenges section lists measurement first: several of these verdicts should be re-graded against this project's own logs once `platonic check` exists to generate them.
