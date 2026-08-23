# Narrow Waists in TypeScript

Third in a series. The first report — [Why LINQ Succeeded](linq-and-narrow-interfaces-2026-08-23.md)
— extracted the pattern. The second — [Candidate Narrow Waists](narrow-waist-candidates-2026-08-23.md)
— brainstormed about forty candidates in a C#-shaped world. This one asks what survives the move to
TypeScript, what breaks, and what becomes possible that was not possible in C# at all.

The summary: **four of the six success factors get cheaper in TypeScript, one gets more expensive,
and one whole archetype mostly dies.** In exchange, TypeScript offers two mechanisms C# does not
have, and they open a category of waist that has no C# equivalent.

## 1. The mechanics, factor by factor

| Factor from the LINQ report | In C# | In TypeScript |
|---|---|---|
| F1 minimal conformance, no obligations | Interface implementation, explicit | **Free** — structural typing; a type conforms by shape |
| F2 closed algebra | Design work | Same design work |
| F3 attach operations non-invasively | Extension methods | **Harder** — see §2, the one real regression |
| F4 cheap production | `yield return` | **Free** — `function*` and `async function*` |
| F5 borrowed algebra | Design work | Same design work |
| F6 conformance by shape | Special-cased in the compiler for `foreach`, LINQ, `await` | **Free and universal** — it is the type system |

F1 and F6 collapse into one another and become the default. In C#, `Span<T>` needed a compiler
special case to be `foreach`-able because it could not implement an interface. In TypeScript the
question never arises: anything with the right shape *is* the type. A waist declared as

```ts
type Tree<T> = { readonly value: T; readonly children: readonly Tree<T>[] }
```

is satisfied retroactively by types that were written years earlier by people who never heard of it,
with no declaration, no adapter, and no dependency. That is a materially stronger version of the
property that made `IEnumerable<T>` universal.

F4 is likewise free: `function*` is `yield return`, and `async function*` covers the streaming case
that C# needed a separate `IAsyncEnumerable<T>` for.

## 2. The one real regression: no extension methods

Section 5 of the LINQ report argues that the narrow waist sat unused for five years and only became
a platform when extension methods arrived. TypeScript has no extension methods. This is the
mechanism that must be replaced, and there are four options.

**Free functions plus explicit nesting.** `groupBy(filter(xs, p), k)`. Honest, zero machinery,
reads inside-out — which is the exact complaint that motivated extension methods in 2007.

**Free functions plus a `pipe` helper.** `pipe(xs, filter(p), groupBy(k))`. Restores left-to-right
order. Costs: every operator must be written curried, type inference through a variadic `pipe` is
fragile past four or five stages, and error messages when it fails are poor. The TC39 pipeline
operator would fix this at the language level, but it is still a proposal and should not be planned
around.

**A wrapper you enter and exit explicitly.** `seq(xs).filter(p).groupBy(k).toArray()`. Method chains,
perfect inference, discoverable by autocomplete — which matters more than it sounds, because
autocomplete is how people find operators they did not know existed. The cost is that the wrapper is
a second type in the system: everything must be wrapped on the way in and unwrapped on the way out.

That cost is smaller than it looks, and here is the argument: **the LINQ report's rule 8 already
requires an explicit exit.** `ToList()` exists because the waist is deliberately too weak for some
jobs. A wrapper simply makes the entry explicit too, and in exchange gives you the one thing
TypeScript otherwise cannot: a place to hang operations that autocomplete finds.

**Prototype augmentation via declaration merging.** Technically available, and wrong for anything
shared: it is a global mutation, it collides across packages, and it breaks the moment two libraries
pick the same name.

**Recommendation.** Wrapper for the sequence-shaped waists, where the operator count is high and
chaining is the whole ergonomic point. Free functions for everything else, where there are three to
six operations and `and(a, b)` reads fine.

## 3. What dies: archetype C

The candidates document's third archetype — the waist as a set of laws, `IMonoid<T>`,
`INumber<T>`, `ISemiring<T>` — mostly does not survive, for two reasons.

**No higher-kinded types.** You cannot write "for any container `F` and any monoid `M`". Encodings
exist (the URI-based defunctionalisation that `fp-ts` uses) and they work, but the type errors they
produce are among the worst in the ecosystem, and every new participant must opt into the encoding.
That violates F1 badly enough to sink the whole thing.

**No operator overloading.** The payoff described in §7.1 of the candidates document — write a
numeric algorithm once, substitute dual numbers to get automatic differentiation, intervals to get
error bounds, a symbolic type to get a printable formula — depends on `a * b + c` meaning something
different per type. In TypeScript that is `add(mul(a, b), c)`, and the substitution stops being
free enough to be worth it.

The salvage: **monomorphise**. A monoid over one concrete type is just two values, and it is still
worth naming, because the payoff — free folding, free parallel reduction, free incremental
recomputation, free `repeat` by squaring — does not actually require genericity over the container.
Write `type Monoid<T> = { readonly empty: T; readonly concat: (a: T, b: T) => T }` and a handful of
concrete instances. That is 80% of the value for none of the type-level cost.

Similarly, `IBlittable` does not port. There are no value types and no `unmanaged` constraint, so the
compiler-verifiable claim that made the marker sound is unavailable. The nearest thing is a typed
array plus a field-offset description, which is a runtime convention rather than a checked property.
It is still worth building for a numeric or geometric workload; it is just not the same design.

## 4. What TypeScript adds that C# does not have

### 4.1 Discriminated unions: pick the initial encoding, not the closure

This is the most consequential difference, and it changes the *default* design for archetype B.

In C#, a combinator library is naturally built from closures: a parser is a function, a predicate is
a function, a field is a function. Composition builds a bigger closure. The value is fast, opaque,
and unserialisable — you can run it, and that is all.

TypeScript makes the alternative ergonomic. Represent the algebra as a discriminated union — the
operations become *data constructors* rather than function compositions — and an exhaustive `switch`
with a `never` check gives you compile-time completeness for every interpreter you write:

```ts
type Pred<T> =
  | { readonly kind: 'all' }
  | { readonly kind: 'not'; readonly inner: Pred<T> }
  | { readonly kind: 'and'; readonly parts: readonly Pred<T>[] }
  | { readonly kind: 'test'; readonly name: string; readonly f: (v: T) => boolean }
```

Now the same value can be evaluated, printed for a user, serialised into a saved search, simplified
algebraically, statically analysed, or compiled to SQL — and each of those is a new interpreter, not
a change to the algebra. The closure form supports exactly one of them.

The trade is real: data is slower than a closure, and adding a constructor breaks every interpreter
whereas adding an interpreter is free. That is the expression problem, and TypeScript hands you the
side of it that most application code wants, because most application code needs to *inspect*
pipelines more often than it needs them fast.

Worth noting explicitly: this is how C# got `IQueryable<T>`, via expression trees. In TypeScript the
same capability is available with no special language support and no run-time translation failures,
because you built the tree deliberately instead of reflecting over a lambda.

### 4.2 Type-level computation: a category of waist C# cannot express

Template literal types, conditional types, and inference give TypeScript a compile-time string and
structure algebra. That makes a *runtime value carry its static type* — and that is a waist with no
C# analogue.

The canonical instance is a schema:

```ts
type Schema<T> = { readonly parse: (u: unknown) => Result<T, Issue[]> }
```

The algebra — `object`, `array`, `union`, `optional`, `refine`, `transform`, `brand` — is closed, and
because TypeScript infers `T` from the *value*, a single schema simultaneously gives you a runtime
parser, a static type, a validator, a serialiser, a form description, and generated documentation.
In C# each of those is a separate artefact kept in sync by hand or by code generation. This is the
single highest-leverage waist available in TypeScript, and it is why the schema libraries won.

The same mechanism supports typed key paths (`"user.address.city"` checked against a record type),
typed route parameters, typed environment variables, and typed query builders. The waist in each
case is a string or a small object; the leverage comes from the type-level function that reads it.

### 4.3 Platform waists that already exist

Some are already shipped and under-used:

* **`ArrayLike<T>`** — `{ length: number; [n: number]: T }` is already in the standard library and is
  the `IReadOnlyList<T>` waist from the candidates document, satisfied structurally by arrays,
  strings, typed arrays, `NodeList`, and `arguments`. The catch is precise: a *lazy* index space
  cannot satisfy an index signature without a `Proxy`, so a computed version needs its own type,
  `{ readonly length: number; readonly at: (i: number) => T }`. Everything else in §2.1 of the
  candidates document — reverse, slice, concat, zip, stride, windows, cartesian as O(1) index
  arithmetic — ports unchanged, including the observation that `filter` is the one operator that
  does not survive.
* **`Iterable<T>` / `AsyncIterable<T>`** — the literal LINQ waist, satisfied by shape, produced by
  generators. Iterator helpers (`map`, `filter`, `take`, `drop`, `flatMap`, `reduce`, `toArray` on
  the iterator prototype) are standardised and present in current Node, which supplies part of the
  algebra natively.
* **`ReadableStream` / `TransformStream`** — the platform's own instance of the pattern, with
  `pipeThrough` as the closure operation. If you are already streaming, extend this rather than
  inventing a parallel one.
* **`AbortSignal`** — small but genuinely closed: `AbortSignal.any([...])` and `AbortSignal.timeout`
  are combinators over a waist that every async API already accepts.

## 5. Additional candidates that are specifically TypeScript-shaped

Beyond the ports, these are ideas that only make sense here.

**The request handler as a monoid of middleware.** `type Handler = (req: Request) => Promise<Response>`
is a one-function waist. Middleware is `(next: Handler) => Handler`, which is a monoid under
composition with the identity function as its unit — so `compose([logging, auth, cors])` is a fold.
Routing is a *different* algebra over the same waist: `route(method, pattern, handler)` combined by
first-match-wins, which is also a monoid. Both `packages/dashboard/src/server.ts` and
`packages/codeview/src/server.ts` hand-roll URL matching against `IncomingMessage`; that is the N×M
symptom, with two servers today and the MCP server as a third shape.

**JSON as the universal waist.** `JsonValue` — already defined in
[init/src/index.ts:15](../packages/init/src/index.ts:15) — is a closed recursive union that anything
serialisable satisfies structurally. The algebra over it is worth writing once: `get` by path, `merge`
with a policy, `diff`, `patch`, `walk`, `prune`, `redact`, `canonicalise` for stable hashing. Every
codebase writes four of these badly. Note it is also a *tree*, so it is the first customer of the
tree waist.

**Structural diffing of typed records.** Because TypeScript is structural, one `diff` over
`JsonValue` covers every record type in the program with no per-type registration. In C# that needs
reflection or generated code.

**The template-literal path lens.** The candidates document proposes `ILens<S, A>` for immutable
update. TypeScript can do better than C# here: a string path checked and typed at compile time gives
`setPath(state, 'a.b.c', v)` with full inference, no lens values to construct, and no composition
machinery. It is a lens whose composition happens in the type system.

**A `Doc` for HTML generation.** `packages/dashboard/src/ui.ts` and `packages/codeview/src/ui.ts`
each build HTML by string concatenation across dozens of sites, with indentation handled by hand.
The Wadler document algebra from §4.2 of the candidates document ports directly and is maybe eighty
lines; escaping then becomes a property of the waist rather than a thing each call site must
remember, which is a security argument as much as an ergonomic one.

**A `Comparator<T>` module.** There are 36 `.sort(` calls across `packages/*/src`. `byKey`,
`reversed`, `thenBy`, `nullsLast` is about twenty lines and removes every hand-written multi-key
comparison in the repo.

**Schema-first configuration and hook payloads.** The hooks package parses external JSON payloads;
a schema waist would give parsing, validation, the static type, and the documentation from one
declaration.

## 6. What the port costs at run time

Three effects worth pricing before committing, because they cut against the C# intuitions.

**The iterator protocol allocates.** Each `next()` returns a fresh `{ value, done }` object. Engines
sometimes eliminate it, and often do not. For arrays under roughly ten thousand elements, native
array methods beat generator pipelines despite materialising intermediates. The practical rule:
**arrays are the default waist for in-memory data; iterables are for genuinely streaming or unbounded
sources.** This inverts the LINQ instinct, where laziness is nearly always the right default.

**Structural typing has no run-time presence.** A value conforming to a waist carries no marker, so
run-time dispatch on "which waist is this?" needs an explicit tag. This is a further argument for the
discriminated-union style of §4.1, where the tag is the design.

**Deep readonly is by convention.** `readonly T[]` is a compile-time check that an `any` or a JSON
parse erases. The LINQ report's argument that read-only is what makes a waist obligation-free is
weaker here, because nothing enforces it at run time. `Object.freeze` at the boundaries, or accepting
the convention knowingly, is the choice — but it should be a choice, not an oversight.

## 7. Shortlist for this repository

Ordered by leverage divided by effort.

| Waist | Evidence in-repo | Effort |
|---|---|---|
| `Result<T, E>` | Five hand-rolled copies with three different error field names | Small |
| `Comparator<T>` | 36 `.sort(` sites | Small |
| Tree — `(node) => readonly node[]` | `walk.ts` for AST, folder entries, JSON, backlog | Small |
| `Doc` for HTML | Two `ui.ts` files, string concatenation throughout | Medium |
| Handler + middleware + routing | Two hand-rolled `IncomingMessage` servers, MCP a third | Medium |
| Schema | Hook payloads, config, MCP tool arguments | Medium |
| JSON algebra | `JsonValue` already exists, no operations over it | Medium |
| Lazy indexed sequence | Only if a compute-heavy workload appears | Defer |

The first three are each under a hundred lines and each delete existing duplication rather than
adding a layer, which is the right way to introduce a waist: **land it as a deduplication, not as an
abstraction.** A waist that arrives with five call sites already converted is evidently useful; one
that arrives empty is a bet.

## 8. The short answer

Yes, it maps — and on balance more cleanly than in C#, because structural typing makes the
conformance point free and generators make production free. Two things change the design rather than
just the syntax. Without extension methods, sequence-shaped waists want an explicit wrapper instead
of a chain that appears on every type. And with discriminated unions and type-level computation,
the natural TypeScript form of a closed algebra is often *inspectable data* rather than composed
closures — which gives you, for free and without run-time translation failures, the thing C# needed
expression trees and `IQueryable<T>` to approximate.
