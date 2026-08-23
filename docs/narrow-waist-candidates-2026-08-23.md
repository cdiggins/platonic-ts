# Candidate Narrow Waists: A Brainstorm

Companion to [Why LINQ Succeeded, and the General Pattern Underneath It](linq-and-narrow-interfaces-2026-08-23.md).
That report extracted a recipe: find the weakest interface that supports your operations, make it
impossible to satisfy wrongly, close the operations over it, attach them without touching
implementers, and provide an explicit exit.

This document applies the recipe as a search. It is a brainstorm, so it is broad and uneven on
purpose; the scoring at the end separates the candidates that look strong from the ones that only
look tidy.

## 1. Three archetypes, because they are designed differently

Before the list, a distinction worth having. The pattern shows up in three shapes, and confusing
them leads to designing the wrong half.

**Archetype A — weakest property, external algebra.** The interface says almost nothing; the
operations live outside it and are added freely. `IEnumerable<T>` plus LINQ. `IReadOnlyList<T>`.
`ITree<T>`. The design work is in choosing what to leave out.

**Archetype B — the algebra is the interface.** One method, and everything else is a *combinator*
that builds new values of the same type from old ones. Parsers, predicates, distance fields, pretty
printing documents, random generators. The design work is in choosing the constructors, and the
result is a small embedded language. These are often called free algebras: the operations are
constructors, and closure is automatic because there is nothing else to return.

**Archetype C — the waist is a set of laws.** `IMonoid<T>`, `INumber<T>`, a mergeable replicated
value. Implementers do carry obligations here, which the LINQ report warns about — but the
obligations are *equations* (associativity, commutativity, identity), so they can be property-tested
mechanically. That is the one acceptable form of semantic obligation: one you can check with a test
generator rather than a code review.

A fourth thing masquerades as the pattern and is not: a **seam**. `IClock`, `IFileSystem`,
`ILogger` are narrow interfaces with no algebra at all. They are valuable — they invert a
dependency and make code testable — but they do not compose, so none of the LINQ reasoning applies
and none of the leverage arrives.

## 2. Sequences and their neighbours

### 2.1 `IReadOnlyList<T>` — the underrated one

You listed it, and I think it is the strongest item on your list. `IReadOnlyList<T>` is `Count` plus
an indexer, which is to say it is a pure function from an integer range to values. Written honestly:

```
IReadOnlyList<T>  ≈  (int Count, Func<int, T> At)
```

Everything `IEnumerable<T>` cannot do cheaply, this can do lazily and in constant time per element,
because every operator is *index arithmetic on a smaller index space*:

| Operator | Implementation | Cost |
|---|---|---|
| `Select(f)` | `(n, i => f(at(i)))` | O(1) to build |
| `Reverse()` | `(n, i => at(n-1-i))` | O(1) |
| `Slice(a,b)` | `(b-a, i => at(a+i))` | O(1) |
| `Concat(other)` | `(n+m, i => i<n ? at(i) : other[i-n])` | O(1) |
| `Zip(other,f)` | `(min(n,m), i => f(at(i), other[i]))` | O(1) |
| `Stride(k)`, `Tile(k)`, `Windows(k)`, `Chunk(k)` | index arithmetic | O(1) |
| `Cartesian(other)` | `(n*m, i => (at(i/m), other[i%m]))` | O(1) |
| `SortedBy(cmp)` | build a permutation array, then index through it | O(n log n) once |

Three things fall out that `IEnumerable<T>` cannot offer:

* **It is re-enumerable and deterministic by construction.** The single-enumeration hazard, which
  section 9 of the LINQ report calls unfixable within `IEnumerable<T>`, simply does not exist here.
* **It is parallelisable without buffering.** Any consumer can split `[0,Count)` into ranges. This
  is the property that makes a data-parallel backend possible at all.
* **`Count` is honest.** The complexity leak that forces LINQ to type-test for `ICollection<T>` at
  run time is gone.

The cost is a real one: laziness by index means work is repeated if you index the same element
twice, so the exit (`ToArray`, or a memoising wrapper) matters more than it does in LINQ, and
`Where` is *not* expressible lazily — filtering does not preserve a computable index without a
scan. That single gap is why both waists need to exist: `Where` marks the boundary between them.

**Verdict: strong.** For numeric, geometric, and any data-parallel work, this is a better waist than
`IEnumerable<T>` and the algebra over it is larger, not smaller.

### 2.2 `IStreamable<T>` — the push side

The dual of pull-based iteration: instead of the consumer asking for elements, the producer is
handed a function and calls it.

```
bool Accept(Func<T, bool> visit)   // return false from visit to stop early
```

One method, no state machine, no allocation per element, and it composes: `Select` and `Where` are
*transformations of the visitor*, not of the source. This is the transducer idea, and it is usually
faster than pull iteration because there is no per-element interface dispatch on the hot path.

Two honest limits. Early termination has to be designed in from the start, which is what the `bool`
return is for; retrofitting it later is a breaking change. And two push sources cannot be `Zip`ped
without one of them being buffered or run on its own thread, because neither can be paused. Pull
composes across sources; push composes across operators.

**Verdict: strong, as a complement rather than a replacement.** Pair it with `IReadOnlyList<T>` and
`IEnumerable<T>`; the three cover indexable, pausable, and fast respectively.

### 2.3 `IFoldable<T>`

```
TAcc Fold<TAcc>(TAcc seed, Func<TAcc, T, TAcc> step)
```

This is the minimal aggregation waist, and it is theoretically complete: a sequence is fully
determined by how it folds, so `Select`, `Where`, `Sum`, and `ToList` are all folds or fold
transformers. In practice it is the same thing as `IStreamable<T>` with an accumulator carried
along, and it has the same early-exit problem in sharper form. Worth knowing as the theory behind
the push waist; not worth shipping as a separate interface.

### 2.4 `IQueue<T>`, `IStack<T>`, `IDeque<T>` — archetype B in disguise

These are only narrow waists in their **persistent** form, where `Push` returns a new stack rather
than mutating one. Made persistent, they become self-returning — `Push : (S, T) → S`,
`Pop : S → (S, T)?` — which is closure in the strict sense, and they become obligation-free because
there is no aliasing question left to get wrong. Made mutable, they are ordinary containers with
ordering obligations, and none of the reasoning transfers.

The interesting property of this family is that the algebra *is* the interface: there are only three
or four operations and they are all on the type. That caps the leverage — you cannot grow the
operator set the way LINQ did — but it also means there is nothing to design wrong. Okasaki's
purely functional data structures are the reference.

**Verdict: good, conditional on persistence.** Note that they also expose `IReadOnlyList<T>` or
`IEnumerable<T>` for free, which is how they join the larger algebra.

### 2.5 `ITree<T>`

```
T Value { get; }
IReadOnlyList<ITree<T>> Children { get; }
```

Or, more weakly and more usefully, no interface at all: a function `Func<T, IReadOnlyList<T>>`.
Obligation-free — no ordering, uniqueness, or acyclicity is promised — and satisfied by ASTs,
directory trees, scene graphs, JSON, DOM, backlog hierarchies, and expression trees alike.

The algebra is genuinely large and almost nobody writes it down: `MapTree`, `Fold`/catamorphism,
`Unfold`/anamorphism, `Prune(predicate)`, `Filter` (keep a node if it or any descendant matches),
`Descendants`, `Ancestors`, `Paths`, `Depth`, `Zip` on matching shape, `Flatten` in pre-, post-, and
level order, and `Rebuild` from a modified traversal. Locations inside a tree get their own small
waist — a zipper, or a path of indices — with its own closed operations: `Up`, `Down(i)`, `Left`,
`Right`, `Replace`.

**Verdict: very strong, and the most commonly re-implemented-by-hand of anything on this list.**
Every codebase with a tree in it contains four partial, subtly different traversals.

### 2.6 `IGraph<T>`

```
IReadOnlyList<T> Neighbours(T node)
```

Closure is weaker than for trees but real: `Reverse`, `Subgraph(pred)`, `TransitiveClosure`,
`Union`, `Product`, and `Contract` all return graphs. The rest of the operations are exits:
topological order, strongly connected components, shortest paths, reachability. Watch for the
obligation trap — the moment the interface promises acyclicity or finite degree without being able
to check it, it has become `IQueryable`.

## 3. Functions over a domain — the geometry family

This family is archetype B throughout, and it is the one where closure is most complete, because
the values are literally functions and composition is the algebra.

### 3.1 `IField<TDomain, TValue>` — `TValue Eval(TDomain p)`

Textures, noise, height fields, weights, animation curves, temperature, density. The algebra:
pointwise arithmetic (`a + b`, `a * k`), `Compose` with a domain warp (`f ∘ g`), `Blend(a, b, t)`,
`Mask`, `Clamp`, `Remap`, `Gradient` (numerically or symbolically), `Transform` the domain,
`Tile`/`Mirror`/`Repeat`. Exits: sample to a grid, an image, a mesh, a vertex buffer.

Every operator returns a field, so a whole shading or deformation stack is one expression with no
intermediate buffers, and the decision of *where to sample* is deferred to the exit. That deferral
is the same win as LINQ's deferred execution, in a domain where the intermediate buffers are
megabytes rather than list nodes.

### 3.2 `IDistanceField` — `float Distance(Point p)`

A field with a numeric law attached, and the best single example of a borrowed algebra outside
relational: constructive solid geometry. `Union = min`, `Intersect = max`, `Subtract = max(a, -b)`,
`Offset(r) = d - r`, `Shell`, `SmoothUnion`, `Transform`, `Repeat`. Exits: marching cubes, ray
march, point query.

The honest caveat, which is exactly the kind of unverifiable promise the LINQ report warns about:
`min` preserves a true signed distance, but `max` and subtraction generally do not — they produce a
conservative bound, not an exact distance. Consumers that assume exactness (sphere tracing with a
full step) will be subtly wrong. The right design response is not to hide this: make the waist
promise only the Lipschitz bound, which every operator *does* preserve, and let exactness be a
separate, optional, checkable claim.

### 3.3 `ICurve<T>` and `ISurface<T>` — `T Eval(float t)`, `T Eval(float u, float v)`

Algebra: `Reverse`, `Trim(a,b)`, `Concat`, `Resample`, `Transform`, `Offset`, `Reparameterise` by
arc length, `Tangent`/`Normal` by differentiation, `Sweep` a curve along a curve to get a surface,
`Loft`. Exits: polyline, mesh, arc-length table. Curves and fields are the same waist with different
domains, which is a hint that the real waist is one level up.

### 3.4 `ITransform` — `Point Apply(Point p)`

The purest case in the whole document: a monoid. Composition is associative, identity exists, and
that is the entire algebra. It is worth naming as an interface precisely because a monoid is the
smallest thing that gives you free `Fold`, free parallel reduction, and free `Repeat` by squaring.

### 3.5 `IBounds` / `IInterval`

`Union`, `Intersect`, `Expand`, `Contains`, `Split`, `Transform` — a lattice, with empty and
universe as the two identities. Small, complete, and the foundation of every spatial index. Also the
right waist for interval arithmetic, which is how a numeric algorithm gets error bounds for free
(see §7.1).

## 4. Parsing, formatting, text

### 4.1 `IParser<T>` — `(T value, int next)? Parse(string input, int pos)`

Parser combinators are archetype B at its most textbook. Constructors: literal, any, satisfy.
Combinators: `Map`, `Then`, `Or`, `Many`, `Many1`, `Optional`, `SepBy`, `Between`, `Not`,
`Lookahead`. All closed. A grammar becomes a value you can build at run time, test in pieces, and
reuse.

The obligation to watch: backtracking and error reporting. If `Or` silently backtracks over
arbitrary input, error messages become useless and performance becomes unpredictable. Decide the
policy once, at the waist, and state it.

### 4.2 `IDoc` — the pretty-printing document

The single best example of rule F5, "borrow the algebra". Wadler's pretty printer, refined by
Leijen, defines a document as `Text | Line | Concat | Nest | Group`, with an algebra that is
closed, has known laws, and comes with a linear-time optimal layout algorithm. Anyone building
code generation, report rendering, error formatting, or HTML emission by string concatenation is
hand-rolling a worse version of this. Exits: render at a given width.

Every string-returning `render*` function in a codebase is a candidate to become a `Doc`-returning
one, and the payoff is that indentation and line breaking stop being the caller's problem.

### 4.3 `IFormatter<T>` — `void Write(T value, ISink sink)`

The contravariant dual of a parser. Algebra: `ContraMap` (format a `U` by turning it into a `T`),
`Concat`, `SepBy`, `Surround`. Pairs with `IParser<T>` into a codec, and codecs have their own
algebra: `InvMap`, product, sum, and versioning. Worth building as a pair, because the round-trip
property is then a free property test.

### 4.4 `IText` / rope — `int Length`, `char At(int)`, `Slice`

`IReadOnlyList<char>` with a better constant factor. Under a rope representation `Concat`,
`Insert`, `Delete`, and `Slice` are all logarithmic and persistent, which turns editor and
code-generation buffers into values. Exits: `ToString`, write to a stream.

### 4.5 `IPattern` — regular expressions as values

`Literal`, `Seq`, `Alt`, `Star`, `Opt`, `Class`. A free algebra with fifty years of theory,
compilable to a DFA. The reason to reify it rather than use strings is composition: a pattern built
from named parts can be documented, tested, and reused; a regex string cannot.

## 5. Bytes, memory, interop

### 5.1 `IBlittable` — and when a marker interface is acceptable

You named this one, and it is the most interesting case in the document, because on the LINQ
report's own criteria a marker interface should be a disaster. `ICloneable` failed exactly because
it was a marker with an unverifiable claim.

`IBlittable` is different in one decisive way: the claim — "this value is a fixed-size blob with no
references" — is *mechanically checkable*. C# already checks it under the name `unmanaged`. That
gives a sharpened rule worth adding to the original report:

> A marker interface is sound when the compiler or a test can verify its claim, and is `ICloneable`
> when it cannot.

What it unlocks is large: array-to-`Span<byte>` reinterpretation, memory-mapped files, GPU buffer
upload, structure-of-arrays layout transforms, wire formats without a serialiser, structural
hashing, and binary diffing. N types times M byte-level operations is a genuine N×M, and this
collapses it.

### 5.2 `IWritableTo<Span<byte>>` — `int ByteCount { get; }`, `int Write(Span<byte> dest)`

The waist for zero-copy output. Algebra: `Concat`, `Framed` (length-prefix), `Chunked`,
`Checksummed`, `Compressed` — each returns another writable. Exits: array, file, socket, GPU
buffer. The mirror waist for input is `T Read(ReadOnlySpan<byte> src, out int consumed)`.

This is the one place where the LINQ-style per-element waist is the wrong altitude, and the report's
§12 warning applies: the waist belongs at the level of *buffers*, not bytes.

### 5.3 `IHashable` — `void HashInto(IHasher h)`

Decouples N hashable types from M hash algorithms, which is otherwise a textbook N×M. Composite
hashing is closed: a type hashes itself by hashing its parts. The obligation is real but small and
statable — equal values must hash the same — and it is property-testable.

### 5.4 `IMemoryOwner` — the trap

Ownership and lifetime obligations cannot be expressed in the type system of most languages, so the
implementer has decisions they can get wrong and the consumer has to care. This is the
`IObservable<T>` failure mode. Necessary, sometimes; not an instance of this pattern.

## 6. Predicates, comparison, access

### 6.1 `IPredicate<T>` — `bool Test(T value)`

Boolean algebra: `And`, `Or`, `Not`, `Xor`, `Implies`, plus `True` and `False` as identities, plus
`ContraMap` to move a predicate from `T` to `U`. Perfectly closed, entirely obligation-free, and
almost always written as ad-hoc inline conditions instead of composable values. The payoff for
reifying is that filters become nameable, testable, and combinable at run time — a saved search, a
rule set, a permission policy.

Reify it as an expression tree rather than a delegate only when you must push it to another
execution engine, and re-read §9 of the LINQ report before you do.

### 6.2 `IComparer<T>` — a monoid nobody uses as one

`ByKey(f)` (contramap), `Reversed`, `ThenBy` (the monoid operation, with the always-equal comparer
as identity), `NullsFirst`/`NullsLast`. Four combinators eliminate every hand-written multi-key
comparison function in a codebase. `IEqualityComparer<T>` gets the same treatment.

### 6.3 `ILens<S, A>` — `A Get(S s)`, `S Set(S s, A a)`

The access waist for immutable data. Closed under composition, which is the whole point: a lens
into a field composes with a lens into an element to give a lens into a nested field, and the deep
immutable update writes itself. Variants: prism (may not be present), traversal (many targets). The
optics literature is a large, well-tested borrowed algebra.

In a codebase that is immutable by policy, this is the answer to "updating deeply nested records is
painful", and it is a better answer than a spread-operator idiom because it is a *value* that can be
passed around.

### 6.4 `IValidator<T>` — `IReadOnlyList<Issue> Validate(T value)`

Algebra: `And` (collect all issues, not just the first), `Or`, `ContraMap`, `ForEach` over a
collection with index paths, `Nest` under a field name. Exits: a `Result`, a report, a set of
diagnostics. Closed, obligation-free, and it makes the common failure of validation code — stopping
at the first error — structurally impossible.

## 7. Laws as the waist — archetype C

### 7.1 `INumber<T>` / `IRing<T>` / `ISemiring<T>`

Generic numeric code written once against a numeric interface runs unchanged on `float`, `double`,
fixed point, complex, interval arithmetic, dual numbers, and symbolic expressions. That last group
is where the leverage is:

* substitute **dual numbers** and every algorithm computes its own derivative — automatic
  differentiation for free;
* substitute **intervals** and every algorithm computes rigorous error bounds;
* substitute **a symbolic expression type** and the algorithm prints its own formula, or compiles
  itself to a shader.

.NET 7's generic math is the production version of this. Obligations are the ring laws, which are
exactly what a property test generates.

### 7.2 `IMonoid<T>` — `T Identity`, `T Combine(T a, T b)`

The smallest thing on this list that pays for itself. Any monoid gets `Fold`, parallel reduction by
splitting anywhere, incremental recomputation, and `Repeat` by binary exponentiation, all for free.
Sum, max, string concat, set union, matrix product, transform composition, and merge policies are
all monoids that get re-implemented separately.

### 7.3 Mergeable state — a semilattice

`Merge` that is commutative, associative, and idempotent gives conflict-free replication for free.
The obligations are heavy but equational and testable. Worth naming here because it is the clearest
demonstration that archetype C is a real category: obligations are acceptable in proportion to how
mechanically you can check them.

## 8. Incremental computation, diffing, layout, generation

### 8.1 `IComputation<T>` — a description of work that can be compared for equality

The waist is a value that says *what to compute*, not the result. Algebra: `Map`, `Zip`, `Bind`,
`Memo`. The exit runs it, consulting a cache keyed by the description. This is what Bazel, Salsa,
and incremental build systems are, and it is heavily underexploited in ordinary application code
where the same expensive derivation is recomputed on every refresh. The obligation — the description
must determine the result — is checkable by running twice in a test.

### 8.2 `IPatch<T>` — a diff as a value

Algebra: `Compose`, `Invert`, `Empty`, and, ambitiously, `Rebase`. A groupoid rather than a monoid.
Flagged with a warning: `Rebase` is where every version control system's hard bugs live, and the
laws are genuinely difficult. Ship `Compose`/`Invert` and be honest about stopping there.

### 8.3 `ILayout` — `Size Measure(Constraints c)`, `void Arrange(Rect r)`

Two methods, and the algebra is the entire vocabulary of user interface layout: `Stack`, `Overlay`,
`Pad`, `Align`, `Fixed`, `Flex`, `Grid`, `Scroll`. Each returns a layout. This is what makes
declarative user interface frameworks composable; the same waist works for report and print layout.

### 8.4 `IGen<T>` — `T Generate(Rng rng, int size)`

Algebra: `Map`, `Bind`, `Zip`, `OneOf`, `Frequency`, `Resize`, `ListOf`, paired with a shrinker.
QuickCheck's borrowed algebra, forty years old, still routinely re-invented badly as ad-hoc test
fixtures.

### 8.5 `IStyle` / attribute maps

A map from key to value with last-wins override is a monoid; that single fact is the whole of
theming, configuration layering, and command-line-over-file-over-default resolution. Usually written
three times per project as bespoke merge functions.

## 9. Scoring

Ranked by expected leverage — how much N×M collapses, times how obligation-free the waist is.

| Candidate | Archetype | Conformance | Obligations | Closure | Leverage |
|---|---|---|---|---|---|
| `ITree<T>` / `children-of` function | A | One function | None | Large | **Very high** |
| `IReadOnlyList<T>` as lazy index space | A | Two members | None | Large | **Very high** |
| `IDoc` (pretty printing) | B | Constructors only | None | Complete | **Very high** |
| `IMonoid<T>` / `INumber<T>` | C | Two members | Equational, testable | Complete | **Very high** |
| `IField` / `ICurve` / `IDistanceField` | B | One method | Numeric, statable | Complete | High |
| `IPredicate<T>`, `IComparer<T>` | B | One method | None | Complete | High |
| `IParser<T>` + `IFormatter<T>` | B | One method | Backtracking policy | Complete | High |
| `IBlittable` | A | Marker, compiler-checked | Verifiable | N/A (enables ops) | High |
| `ILens<S,A>` | B | Two functions | Get/set laws, testable | Complete | High |
| `IStreamable<T>` (push) | A | One method | None | Large | High |
| Persistent `IStack`/`IQueue`/`IDeque` | B | Three methods | None | Self-returning | Medium |
| `IWritableTo<Span<byte>>` | A | Two members | Size must match | Medium | Medium |
| `IComputation<T>` (incremental) | A | One method + equality | Determinism, testable | Medium | Medium |
| `IValidator<T>`, `IGen<T>`, `ILayout` | B | One or two methods | None | Complete | Medium |
| `IGraph<T>` | A | One function | None if unpromised | Partial | Medium |
| `IPatch<T>` | B | Two methods | Rebase laws are hard | Partial | Low, risky |
| `IMemoryOwner`, `IObservable<T>` | — | Low | **Unverifiable** | Large | **Avoid as waists** |

## 10. The test to apply to a new candidate

Six questions, in order. The first failure is usually decisive.

1. **Can I state the whole obligation in one unambiguous sentence?** If not, stop — this is
   `ICloneable`. If the obligation is an equation, it is acceptable, because it is testable.
2. **Do the operations return the waist type?** If most of them return something else, you have a
   utility library. Make it a good one and move on.
3. **Is there an identity element?** A monoid smell is the strongest positive signal available. It
   predicts free folding, free parallelism, and free incrementality.
4. **What is the cheapest way to produce one?** If it takes more than a few lines, design that down
   before designing anything else; adoption tracks production cost, not consumption cost.
5. **Does an algebra for this already exist in the literature?** Relational, boolean, lattice,
   monoid, CSG, optics, parser combinators, Wadler documents, QuickCheck generators. Take it.
6. **Where is the exit, and what does it cost?** A waist with no exit gets abandoned wholesale the
   first time someone needs the one thing it cannot express.

## 11. Two closing observations

**The best candidates are usually functions, not interfaces.** `children-of` is
`Func<T, IReadOnlyList<T>>`. A field is `Func<P, V>`. A predicate is `Func<T, bool>`. A comparer is
`Func<T, T, int>`. Wrapping these in a nominal interface buys a name and a place to hang operations
in languages with extension methods, and costs conformance friction in languages without them. Pick
per language, and note that the *waist* is the function either way.

**The pattern is a search strategy, not just a design.** Its practical use is as a question to ask
about existing code: where are we writing N×M adapters by hand? Duplicated traversals, duplicated
comparison functions, duplicated string-building with manual indentation, duplicated merge logic,
and duplicated poll loops are all the same symptom. Each is a waist that was never named.
