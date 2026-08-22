# Platonic TypeScript

An opinionated approach to writing [TypeScript](https://www.typescriptlang.org/) for humans and coding agents.

## Motivation 

The goal of this project is to use coding agents (e.g. Claude code, Cursor) to:
1. finish work faster
2. consume fewer tokens

A number of sub-goals fall from this:
* increase agentic accuracy (first 
* rely more on automated tools, less on agents
* make it easier for multiple agents to work together

## Observations 

The following observations are largely undisputed:

* Generally speaking projects start fast, and slow down as features are added
* As features are added files get bigger, and more coupled
* As files get bigger, edits become more expensive, and more prone to error
* Large files, coupled concern, and mutable state make agentic parallelism harder
* Mutable state is harder to reason about
* Agents are more effective when code is discoverable, and grouped by concern
* When code is pure functional, tests don't have to be rerun each time
* Pure functional code is easier to reason about 
* Documentation and code can get out of sync, causing confusion
* Agents have a tendency to store historical records, or reference missing/irrelevant context in comments
* Agents can be overly verbose
* It is hard to measure the impact of different tools/approaches
* TDD is too strict of a framework in some cases
* Existing tools and approaches from even a year ago (e.g. 2025) are much less longer relevant, LLMs are more capable and less error prone. 
* Agents need flexibility to backtrack as they work

### Weak Anecdotal Evidence of Agentic Behavior

The following are anecdotal observations of agentic behavior from my personal work, that I do not yet have strong evidence of. 

* Forcing an agent to explain itself to me in simple language, can cause it to think more clearly, and reevaluate its recommendations
* Asking lots of questions of an agent, seems to help it better plan, and execute on work 
* Providing simple prioritized principles for decision making in plain language is very effective 
* Overly precise or strict rules and enforcement, can sometimes slow things down (e.g., agent loops trying to reach a specific word count) 
 
I would like to find a way to 

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
* Write code
* Expressions over
* Perform spikes and investigations early as required, as explicit tests.
  
## Principles 

0. Correctness - proofs and static analysis trumps tests
1. Reusable - without having to change internals 
2. Robust - impossible, or at least, hard to use incorrectly. 
3. Fail fast - 
4. Clarity - of intent, for programmers familiar with language. 
5. Brevity - without sacrificing clarity 

## Coding Best Practices

0. DRY - Don't repeat yourself
0. KISS - Keep it super simple
0. TSTTCPW - Consider "The simplest thing that could possibly work"
0. Write code (functions/types/libraries) so that it can be easily adapted and reused in other contexts - with minimal change
0. Expressions over procedures
0. Data transformation 
0. Functions signature, type declarations, and interfaces - require more clarity and care then implementations. 
0. Conservative in what it 
0. Don't test what is already known or proven.
   
## Ideas 


## Challenges

Continuous improvement - making sure agents, tools, process, get better over time
Measurement - moving from anecdote to evidence, effectiveness of agents/process, quality of code
Prioritization - Making sure agents prioritize tasks and work appropriately 
Goal alignment - between the human sponsor and the agents
Observability - making it obvious to a human (as well as supervising agent) the status of work, things that are working well. 

## Documents

Early design notes. Everything here is a first draft, and nothing is implemented yet.

* [An Agent Development Framework for TypeScript](docs/agent-development-framework-2026-08-18.md) — where this could go: a restricted TypeScript subset, rules moved out of prompts and into tools, and a gate that runs continuously so feedback is fast and small.
* [Off-the-Shelf Tooling Catalogue](docs/tooling-catalog.md) — candidate tools and libraries by job to be done, with overlaps flagged and a ten-item shortlist.

## History

This project was started on August 22nd, 2026 by Christopher Diggins, released under the MIT License. 
It built upon prior work in [Platonic.CSharp](https://github.com/cdiggins/Platonic.CSharp). 

