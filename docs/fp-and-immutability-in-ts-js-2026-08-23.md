# Functional Idioms and Immutability in TypeScript and JavaScript

**Status:** technical report.
**Date:** 2026-08-23
**Companion to:** [pure-fp-for-agents-2026-08-22.md](pure-fp-for-agents-2026-08-22.md)

---

## 1. Scope

The [companion report](pure-fp-for-agents-2026-08-22.md) asks whether pure functional style pays off when a coding agent is the primary author. This report asks a narrower and more mechanical question: **what actually happens — good and bad — when you write functional, immutability-first code specifically in TypeScript and JavaScript?**

That language pair matters, because JS/TS is a genuinely awkward host for functional programming. It has first-class closures, cheap object literals, and a structural type system that models algebraic data well. It also has no persistent data structures in the standard library, no tail-call elimination in any shipping engine, no value-equality primitive for objects, no pattern matching, and a runtime whose optimizer was tuned for object-oriented and imperative code. Every claim about FP in JS/TS has to be evaluated against that specific substrate, not against Haskell's.

The report separates four things that get conflated in these arguments:

1. **Immutability as a discipline** — never mutating a value after construction.
2. **Immutability as a type-system constraint** — `readonly`, `Readonly<T>`, `as const`.
3. **Immutability as a runtime guarantee** — `Object.freeze`, persistent data structures.
4. **Functional idioms** — expression orientation, higher-order functions, `map`/`filter`/`reduce`, currying, composition, `Result`/`Option` types, and the heavier abstractions (functors, monads, effect systems).

They have different costs and different payoffs, and most of the practical advice in section 8 comes from keeping them apart.

---

## 2. What immutability buys you

### 2.1 Aliasing bugs stop existing

The single largest category of defect that immutability removes is the one where two references point at the same object and one of them writes. In JS this is unusually easy to hit, because everything non-primitive is passed by reference and the language provides no way to signal ownership.

```ts
function normalize(config: Config) {
  config.paths = config.paths.map(p => p.trim()); // caller's object, mutated
  return config;
}
```

Nothing here is exotic; the function looks like it returns a value. The caller's `config` is modified anyway, and if that object was also captured by a cache, an event handler, or a previous render, the effect surfaces somewhere unrelated. Copy-on-write removes the whole class:

```ts
const normalize = (config: Config): Config => ({
  ...config,
  paths: config.paths.map(p => p.trim()),
});
```

This is not a statistical claim about defect rates — it is structural. A value that is never written after construction cannot be corrupted by distant code, so a whole category of "who changed this?" debugging disappears rather than getting easier.

### 2.2 Change detection becomes O(1)

React, Vue's `shallowRef`, Redux, Zustand, Solid stores, MobX's observable comparison, `useMemo`/`useCallback` dependency arrays, and virtually every memoization utility in the ecosystem compare with `Object.is`. That comparison is meaningful **only** if updates produce new references and non-updates preserve old ones. Immutability is not a stylistic preference in this ecosystem; it is the precondition for the framework's core optimization.

The failure mode is well known and expensive in both directions:

- **Mutating in place** → identity unchanged → memoized subtree does not re-render → stale UI.
- **Rebuilding everything on every update** → identity changes everywhere → memoization never hits → the app re-renders the world.

Structural sharing is what threads that needle: a new root object, but unchanged branches keep their old identity, so `Object.is` says "unchanged" exactly where nothing changed.

### 2.3 Time travel, undo, and diffing become trivial

If states are values, keeping the last N of them is just keeping N references. Redux DevTools' time-travel debugging, undo stacks, optimistic-update rollback, and state snapshots in tests all follow directly. With in-place mutation each of these requires either a manual inverse operation per action or a deep clone per step.

### 2.4 Concurrency safety, in the narrow places JS has concurrency

JS is single-threaded per agent, so immutability does not buy data-race freedom the way it does in Java or Rust. It does buy two real things:

- **Interleaving safety across `await` points.** Any `await` is a yield. Code that reads an object, awaits, then writes back based on the stale read is a genuine race, and it is common. Values that never change cannot go stale under you.
- **Workers and `structuredClone`.** Immutable, plain-data values are exactly what serializes cleanly across a `postMessage` boundary. Objects with methods, class instances, and cyclic mutable graphs are not.

### 2.5 Tests get shorter

Pure functions over immutable data need no fixtures, no setup/teardown, no mocks for collaborators that mutate. The test is `expect(f(input)).toEqual(expected)`. This compounds: the fewer objects a test must construct to reach a state, the less test code rots when the shape changes.

---

## 3. What immutability costs you

### 3.1 Allocation and GC pressure are real

Copy-on-write with spread creates a new object per update. For small objects in cold paths this is irrelevant — V8's young-generation ("scavenger") collector makes short-lived allocation cheap, and objects that die young are close to free. The cost becomes real in three specific shapes:

**Large arrays updated per-item.** `[...arr, x]` inside a loop is quadratic. This is the single most common accidental performance bug in immutability-first JS:

```ts
// O(n²) — allocates and copies the whole array n times
const result = items.reduce((acc, x) => [...acc, transform(x)], [] as T[]);

// O(n) — same semantics, one allocation
const result = items.map(transform);
```

**Deep spread chains.** Updating a leaf in a nested structure requires rebuilding every ancestor. Five levels deep means five new objects per update. That is *cheaper* than a deep clone (which rebuilds siblings too), but it is not free, and the code is ugly enough that people get it wrong:

```ts
const next = {
  ...state,
  users: {
    ...state.users,
    [id]: { ...state.users[id], profile: { ...state.users[id].profile, name } },
  },
};
```

**Hot loops over numeric data.** Immutable style in a physics step, an image filter, or a tight parser loop is a bad trade. Typed arrays and in-place mutation win by large factors, and no amount of structural sharing recovers it. The mitigation is not "abandon immutability" but "keep the mutation local": build the buffer imperatively inside a function that neither reads nor writes anything outside itself, and hand back a value. The function is still pure from the outside.

### 3.2 Spread is shallow, and that surprises people

`{...obj}` copies one level. Nested objects and arrays are shared with the original. That is usually what you want (it *is* structural sharing), but it means a "copy" that is then mutated deeper corrupts the original. Mixed disciplines — some code copies, some mutates — are worse than either discipline applied consistently.

### 3.3 `Object.freeze` is a trap in hot code

Freezing gives you a runtime guarantee, and in a strict-mode module a write to a frozen object throws instead of silently no-op'ing. That is genuinely useful for catching discipline violations. But frozen objects historically take a slower path in V8 for some access patterns, freezing is O(properties) per object and non-recursive, and deep-freezing a large structure on every update is far more expensive than the update itself.

The pragmatic pattern is **freeze in development, skip in production**:

```ts
const seal = <T>(x: T): T => (import.meta.env.DEV ? deepFreeze(x) : x);
```

You get the violation detection during development and the fast path in production. Note that this makes freezing a *testing* tool, not a safety property you can rely on at runtime — which is the honest framing anyway.

### 3.4 There are no persistent data structures in the platform

Clojure, Scala, and Haskell ship HAMTs, finger trees, and persistent vectors. JS ships `Array`, `Object`, `Map`, and `Set`, all mutable, none persistent. So the ecosystem improvises:

- **Spread everywhere** — no dependency, O(n) copies, quadratic if misused.
- **Immer** — write mutable-looking code against a Proxy draft, get a structurally shared immutable result. Ergonomically excellent, ~3–5 KB, and the Proxy layer adds per-operation overhead that matters only if you are doing many small updates in a hot loop. Its `produce` is the default inside Redux Toolkit, so a very large fraction of React applications already depend on it.
- **Immutable.js** — true persistent structures (HAMT-backed maps, tries for lists), genuinely good asymptotics for large collections, but it forces its own types across every boundary, interoperates badly with plain-object APIs and JSON, is large, and is essentially in maintenance mode. Its `List`/`Map` types also do not play well with TypeScript's structural inference.
- **Mori, `@thi.ng/associative`, and friends** — niche but real options with persistent structures and better tree-shaking.

The honest summary: for structures under a few thousand entries updated at UI frequency, spread or Immer is fine and the asymptotic argument is theater. For genuinely large collections with frequent updates, either use a persistent library or accept a mutable core behind a pure façade.

### 3.5 There is no value equality

`{a: 1} !== {a: 1}`. This is the deepest structural mismatch between JS and functional programming, and it propagates:

- `Set` and `Map` key on identity, so you cannot use a record as a key without serializing it.
- Deduplication, grouping, and caching by composite key all require a manual key function or a deep-equal.
- Deep equality (`fast-deep-equal`, `dequal`, Lodash `isEqual`) is O(size) and easy to reach for reflexively, which quietly reintroduces the cost that reference comparison was supposed to eliminate.

The **Records and Tuples** proposal was the intended fix — deeply immutable, compared by value, usable as `Map` keys. It reached Stage 2 and then stalled; TC39 has signalled that the original design will not proceed as specified, with follow-on work exploring a narrower "composite values" direction. Plan on not having it. (Check the current TC39 proposals list before relying on any of this; the state changes.)

### 3.6 Debugging and inspection get noisier

Immer drafts show as Proxies in the debugger. Immutable.js collections show as their internal trie nodes rather than the data. Deep spread chains produce stack frames that all look alike. Frozen objects can't be poked at from the console to test a hypothesis. None of these is fatal; all of them add friction relative to inspecting a plain mutable object.

---

## 4. What TypeScript's type system actually gives you

This is where TS diverges most sharply from JS, and where most of the practical wins live.

### 4.1 `readonly` is shallow and erasable — know what you bought

```ts
interface Config { readonly paths: readonly string[]; }
```

- `readonly` on a property blocks assignment to that property. It does not make the referenced object immutable.
- `Readonly<T>` is one level deep. There is no built-in `DeepReadonly`; you write it recursively yourself, and it interacts badly with functions, `Map`/`Set`, and branded types unless carefully written.
- All of it vanishes at compile time. A JS caller, an `any`, or a `JSON.parse` result walks straight through.
- `readonly` is deliberately **not** checked in assignability for object types: `const c: Config = mutableConfig` is allowed, and so is passing a `{paths: string[]}` where `Config` is expected. Arrays are stricter (a `readonly T[]` is not assignable to `T[]`), which is why `readonly` on array parameters is the highest-value use of the keyword.

The practical rule: `readonly` catches *your own accidental mutations* at the point of writing. It is a discipline enforcer, not a guarantee, and treating it as a guarantee is a real hazard.

### 4.2 `as const` is the cheapest immutability win in the language

```ts
const MODES = ['read', 'write', 'admin'] as const;
type Mode = typeof MODES[number]; // 'read' | 'write' | 'admin'
```

One keyword produces deep readonly-ness *and* the literal union, keeping the runtime list and the type in sync forever. There is no downside and it should be near-automatic on configuration and lookup tables.

### 4.3 Discriminated unions plus exhaustiveness is the real prize

Sum types are the functional idiom that TypeScript models best, and the payoff is disproportionate:

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

const render = (r: Result<User, ApiError>): string => {
  switch (r.ok) {
    case true:  return r.value.name;
    case false: return r.error.message;
  }
};
```

Add a variant, and every non-exhaustive `switch` becomes a compile error (with `switch` returning a value, or with an explicit `never` assertion in the default branch). This is the mechanism by which "make illegal states unrepresentable" actually works in TS, and unlike most FP borrowings it costs nothing at runtime — the objects are plain, JSON-serializable, and debuggable.

### 4.4 Where TS's inference gives out

TypeScript is structurally typed and has no higher-kinded types. That has two concrete consequences:

- **Generic point-free composition degrades.** A variadic `pipe`/`compose` is typed with a stack of hand-written overloads (this is exactly what fp-ts, Effect, and RxJS all do). Past the overload count, or with generic functions in the chain, inference collapses to `unknown` and you start annotating by hand.
- **Typeclass-style abstraction is emulated, not supported.** fp-ts's HKT encoding works, but the error messages it produces when inference fails are among the worst in the TS ecosystem — multi-hundred-line types that neither a newcomer nor, notably, a coding agent parses reliably.

Effect and fp-ts v2's `pipe`-first style exist largely to work around this. It is worth knowing that the awkwardness is a language limitation, not a library defect.

---

## 5. Functional idioms: which ones pay in JS/TS

### 5.1 Clear wins

**`map`/`filter`/`reduce`/`flatMap` over hand-rolled loops.** Named intent, no index arithmetic, no accidental mutation of the accumulator. Slower than a `for` loop by a constant factor that is invisible outside hot paths. Modern additions — `Array.prototype.at`, `findLast`, and the copying methods `toSorted`, `toSpliced`, `toReversed`, `with` — remove the most common reasons to reach for mutation. `toSorted` in particular eliminates the classic `arr.sort()`-mutates-the-caller bug, and `Object.groupBy` / `Map.groupBy` cover the most common `reduce` that people write badly.

**Pure functions with effects pushed to the edges.** The pattern that survives every critique: a functional core computing values, an imperative shell doing I/O. It requires no library, no new vocabulary, and gives you the testability and local-reasoning benefits directly.

**Expression orientation.** `const x = cond ? a : b` over `let x; if (...) x = a; else x = b;`. Fewer states, no uninitialized window, and `const` everywhere means "this binding never changes" is checked rather than assumed.

**`Result`/`Option` at fallible boundaries.** Making failure a value in the type signature is the single highest-leverage import from FP for typed JS. The caller cannot forget to handle it, because the compiler will not let them read `.value` without narrowing. But see 5.3.

**Function-level composition with a monomorphic `pipe`.** Composing three or four concrete, named functions reads well and types cleanly.

### 5.2 Mixed results

**Currying and partial application.** Genuinely useful with a `pipe`-first API (`filter(pred)` returning `xs => xs.filter(pred)`). Genuinely painful in the general case: inference is worse, stack traces lose names, and `fn(a)(b)(c)` is unidiomatic enough in JS that it slows down every reader who did not write it.

**Point-free style.** Occasionally elegant. Frequently a readability net loss in a language with no first-class composition operator, and a debugging net loss because intermediate values have no names to inspect. Treat it as a tool for short, obvious chains only.

**Immutable-by-default class-free modeling.** Plain data plus module-level functions works well and serializes cleanly. The cost is losing `instanceof`, method discovery via autocomplete on the value, and the OO idioms that most of the surrounding library ecosystem expects.

**Transducers.** Solve a real problem — chained `map().filter().map()` allocates an intermediate array per stage — but the fix is only worth it for large collections or repeated pipelines, and the machinery is heavy for most codebases. Often a single `reduce`, or lazy iteration with generators, is the simpler answer to the same problem.

### 5.3 Costs that are frequently understated

**Stack depth.** No JS engine except JavaScriptCore ships proper tail calls, despite ES2015 specifying them. Recursion over a list of ten thousand items overflows. Any "just use recursion instead of loops" advice is wrong in this ecosystem beyond bounded depth, and every serious FP library in JS implements trampolining or explicit stacks internally because of it.

**No laziness.** Haskell's idioms assume lazy evaluation; JS is strict. `list.map(expensive).find(pred)` does all the work. Generators and iterator helpers (`Iterator.prototype.map`/`filter`/`take`, now available in current engines) recover laziness where you need it, but you have to reach for them deliberately.

**Error handling splits into two worlds.** Once you adopt `Result`, you have two error channels: exceptions from every library you did not write, and `Result` from your own code. The boundary must be maintained by hand, and if it is not, you end up with both — which is worse than either. Async makes it harder still: `Promise` is itself a rejection channel, so `Promise<Result<T, E>>` gives you three ways to fail. Adopting `Result` is a *whole-codebase* decision, not a local one.

**Heavy abstraction has a steep and non-obvious cost.** fp-ts and Effect are well-engineered and solve real problems (typed errors, dependency injection, structured concurrency, resource safety). They also impose a large vocabulary, an idiosyncratic call style, poor inference failure modes, and a hiring/onboarding tax. Effect in particular is a runtime and a paradigm, not a utility library, and adopting it is closer to adopting a framework than adding a dependency. The relevant question is not "is this good?" — it is "does this team, and the tooling that generates code for it, know this dialect?"

**Training-data distribution.** This is the argument the companion report makes at length, and it applies with force to library choice. Plain functions over readonly plain data are massively represented in the corpus every code model was trained on; monadic fp-ts and Effect are not. Idiomatic-but-boring functional TypeScript gets better generated code, better completions, and better agent edits than clever functional TypeScript. This inverts the usual "more powerful abstraction is better" intuition and is, in 2026, one of the strongest practical arguments for the restrained style.

**Bundle size.** Lodash-fp and Immutable.js are large and tree-shake poorly. Ramda tree-shakes reasonably in modern bundlers but its auto-curried, `any`-heavy typings are weak. Immer is small. Native methods are free.

---

## 6. Performance: what the mechanism actually says

Avoid both of the standard overclaims ("immutability is slow" / "structural sharing makes it free"). The accurate version:

- **Short-lived allocation is cheap.** V8's generational collector handles the copy-on-write pattern well; most spread results die in the nursery.
- **Consistent object shapes matter more than allocation count.** Spread produces objects with the same hidden class when the key set is stable, which keeps property access monomorphic. *Conditionally* adding keys (`...(x ? {k: v} : {})`) produces varying shapes and deoptimizes access sites — a much bigger effect than the allocation itself.
- **Immutability makes memoization sound, and memoization is usually the bigger win.** The reference-equality guarantee that copy-on-write buys typically saves far more work in a UI than the copies cost.
- **The asymptotic hazards are the ones to police:** array-spread-in-a-loop (quadratic), deep-clone-per-update, and deep-equal used as a substitute for reference equality. These are what actually show up in profiles — not the spread operator itself.
- **Measure in your app, not in a microbenchmark.** Engine behavior around frozen objects, Proxy overhead, and megamorphic access is version-dependent, and published numbers age badly.

---

## 7. Ecosystem friction

Worth naming plainly, because it is where an immutability-first codebase actually bleeds:

- **Everything at the edges is mutable.** DOM nodes, `Request`/`Response` bodies, streams, database drivers, file handles, canvas contexts. The functional core / imperative shell split is not a stylistic preference here; it is the only way the two halves meet.
- **`JSON.parse` returns mutable, untyped data.** Immutability starts *after* validation, so a parse-and-validate boundary (Zod, Valibot, ArkType) is where readonly types should be minted.
- **Class-based libraries fight plain data.** ORMs, many SDKs, and most of the Node standard library hand back objects with methods and internal state. Converting at the boundary costs code; not converting leaks mutability inward.
- **Linting helps but does not close the gap.** `eslint-plugin-functional` (`no-let`, `immutable-data`, `no-expression-statements`), `prefer-const`, and `no-param-reassign` catch most accidental mutation in your own source. None of them sees through `any`, external libraries, or JS callers.

---

## 8. Recommendations

Ordered by return on effort, highest first.

1. **`const` everywhere; `let` only where reassignment is the clearest expression.** Free, universally understood, checked.
2. **`readonly` on every array and object parameter that the function does not intend to modify.** Highest-value use of the keyword — array assignability is actually enforced.
3. **`as const` on all literal configuration and lookup tables.** One keyword, deep readonly plus literal types.
4. **Discriminated unions with exhaustive matching for state.** The single biggest correctness win available in TypeScript.
5. **Functional core, imperative shell.** Pure computation over values; I/O and mutation confined to a thin, named boundary.
6. **Native copying array methods** (`toSorted`, `toReversed`, `with`, `toSpliced`) over mutating ones. Same cost, no aliasing bug.
7. **Immer for anything with nested state updates.** Buys correct structural sharing and readable update code, at a size and speed cost that is negligible outside hot loops.
8. **Deep-freeze in development only.** Catches discipline violations without paying for them in production.
9. **Allow local mutation inside pure functions.** A `for` loop and a mutable accumulator that never escape the function are pure from the outside and often much faster. This is the pressure valve that keeps the discipline sustainable.
10. **Reserve `Result`/`Option` for boundaries you control, and decide once, codebase-wide.** Half-adopted, it is worse than exceptions.
11. **Be conservative about fp-ts and Effect.** They are real engineering, and they are a dialect. Adopt only with a team that will learn it and a codebase big enough to amortize it — and note that agent-generated code will be measurably worse in that dialect than in plain typed TypeScript.
12. **Do not use recursion where a loop will do, and never for unbounded input.** No tail calls; you will overflow.

---

## 9. Conclusion

Immutability in TypeScript and JavaScript is a strong win, and functional idioms are a qualified one — but for reasons that are specific to this ecosystem rather than inherited from the FP literature.

Immutability pays because the entire modern JS frontend is built on reference-equality change detection, so copy-on-write is not an added discipline but the one the frameworks already assume. It also removes the aliasing bugs a language with no ownership model makes structurally easy to write. Its costs — allocation, deep-update ugliness, shallow `readonly`, the missing persistent structures, the missing value equality — are real, and every one of them has a known mitigation.

Functional idioms pay in inverse proportion to their sophistication. Pure functions, plain immutable data, sum types with exhaustive matching, and effects at the edges are close to unambiguously good: they cost nothing at runtime, they type well, they debug well, and they are what the surrounding ecosystem and every code model already speak fluently. Point-free composition, currying, higher-kinded emulation, and full effect systems are where the language stops cooperating — inference degrades, error messages become unreadable, stack traces lose their names, and the code drifts away from the dialect that both new hires and generated code handle well.

The recommendation is therefore not "be more functional" but **"be immutable by default and functionally plain."** Take the parts of FP that JavaScript's runtime and TypeScript's type system genuinely support, apply them everywhere, and leave the parts that require a different language to a different language.
