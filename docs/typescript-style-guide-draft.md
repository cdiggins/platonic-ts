# TypeScript Programming Guide — Ara 3D Style (Draft)

This is a draft. It ports the Ara 3D SDK C# house style
(`~/git/studio/docs/csharp-style-guide-for-agents.md`) to TypeScript, section for section, so
that code in both languages reads as one body of work. It is written for handwritten library
code; generated code, vendored code, and `node_modules` keep their own conventions.

This repository already has an enforced rule set in [style-guide.md](style-guide.md) with
stable `PS-nnn` IDs. This document does not replace it. Where the two agree, the `PS-nnn` ID is
cited. Where the C# style implies something the `PS-nnn` rules do not yet say, it is called out
as new. Conflicts are listed at the end.

## Core philosophy

1. **Functional-first.** Pure functions, immutable data, expression-bodied members. A type is
   data; behaviour lives in free functions in a module named for the subject. There are no
   classes (PS-002) and nothing to inherit from, so the C# rule "behaviour lives in extension
   methods" becomes "behaviour lives in exported `const` arrows next to the type they act on".
2. **Small and dense.** One concept per file. The C# target is about 100 lines; aim for the
   same and treat 300 as the hard cap (PS-024). Most functions are one expression (PS-028).
   More than about 20 lines is usually two functions (PS-055).
3. **Composition over inheritance.** No hierarchies exist to build. Capabilities are expressed
   as small structural types and generic constraints, not as a base type:
   `<T extends Transformable3D>` rather than an abstract parent.
4. **APIs read as pipelines.** Design so callers can compose:
   `pipe(surface, toQuadGrid(n), triangulate, weldVertices, flipFaces)`. The chainability is
   the point; see *Chaining without extension methods* below.
5. **No speculative abstraction.** Write the concrete thing. Introduce a type parameter or a
   shared helper only at the second real use, and prefer waiting for the third (PS-049,
   PS-051).
6. **Every function is a public API.** Write as if strangers will consume it: usage obvious
   from the signature, types steering callers toward correct use, and the function easy to move
   to another package. Reuse existing functions before adding new ones — the path of least
   resistance must be the best-practice path.

## Formatting

- Expression bodies, with the `=>` on the following line and indented — the direct analogue of
  the C# rule:

  ```ts
  export const flipFaces = (mesh: TriangleMesh3D): TriangleMesh3D =>
    ({ ...mesh, faceIndices: mesh.faceIndices.map(f => [f[2], f[1], f[0]] as const) })
  ```

- Braces only where a statement body is genuinely needed. If a function needs
  `{ ... return ... }`, ask whether it is really two functions.
- Allman braces do not transfer. Automatic semicolon insertion makes a newline before `{`
  hazardous in some positions, and every TypeScript reader expects K&R. Use K&R: opening brace
  on the same line. This is the one deliberate divergence in formatting.
- No trailing semicolons, two-space indentation, single quotes, trailing commas in multi-line
  literals — matching the existing code in this repository. (The C# guide's four-space indent
  does not carry over.)
- One blank line between top-level members. No banner comments, no region dividers, no
  commented-out code.
- Object and array literals returned from an expression body get wrapped in parentheses rather
  than promoted to a statement body.

## Naming

- `PascalCase` for types; `camelCase` for functions, values, and parameters. No `_camelCase`:
  there are no private fields, and a module-private binding is simply not exported.
- Names are short, mathematical, and domain-specific: `evaluate`, `deform`, `sample`, `map`,
  `zip`, `withPoints`, `toQuadGrid`. Prefer domain vocabulary over generic verbs —
  `weldVertices`, not `processMesh` (PS-047).
- No abbreviations (PS-033). The C# guide's short names are short *words*, not truncations.
- A C# extension class named for its subject (`MeshModifiers`) becomes a module named for the
  subject: `meshModifiers.ts`, `parametricSurface.ts` (PS-041). There is no wrapper object
  around the functions; the module is the grouping.
- Modified-copy functions use a `with` prefix (`withFaceIndices`) or a verb returning a new
  value (`translate`, `scale`, `repeat`, `setDomain`). A `with…` function never mutates
  (PS-004, PS-027).
- Verbs for functions, nouns for types (PS-047). `Manager`, `Helper`, `Util`, `Service`,
  `Handler`, `Info`, `Data`, and `Base` are banned in both languages.

## Types and data

- A `readonly record struct` becomes a `readonly` type alias plus a factory function. Use
  `type`, never `interface` (PS-026); every field `readonly` (PS-027).

  ```ts
  export type VertexKey = { readonly x: number; readonly y: number; readonly z: number }

  export const vertexKey = (x: number, y: number, z: number): VertexKey => ({ x, y, z })
  ```

- `IReadOnlyList<T>` becomes `readonly T[]` in every parameter and return position (PS-027).
  Never `T[]`, and never a lazy iterable in a public signature: `Iterable<T>` carries the same
  hidden multiple-enumeration problem as `IEnumerable<T>`. If a producer must be lazy, say so
  in the type (`() => readonly T[]`) rather than hiding it.
- Sealed concrete classes have no analogue and need none. Discriminated unions of `readonly`
  records cover the cases C# would model with a small class hierarchy. Unions of string
  literals replace `enum` (PS-029).
- Helper types that are meaningless outside their owner stay in that file and are not exported.
  The C# nesting `AabbTree.Node` becomes an unexported `type Node` in `aabbTree.ts`.
- Wrapping a raw function type in a named concept still applies, but the wrapper is a type
  alias, not a class:

  ```ts
  export type Curve3D = (t: number) => Point3D

  export const evaluate = (curve: Curve3D, t: number): Point3D => curve(t)
  ```

- `undefined`, never `null` (PS-031). Convert at the IO edge.

## Functions and APIs

- Default to exported `const` arrow functions (PS-028) whose first parameter is the subject,
  named for its type. This is the direct translation of `this TriangleMesh3D mesh`:

  ```ts
  export const doubleSided = (mesh: TriangleMesh3D): TriangleMesh3D =>
    addFaces(mesh, flipFaces(mesh).faceIndices)
  ```

- Exported functions declare their return type (PS-021). Named exports only (PS-022).
- Build complex operations from small named ones. `doubleSided` is one line calling `addFaces`
  and `flipFaces`, not an inline loop (PS-052).
- Defaults come from optional parameters (`numberOfRows = 0` meaning "same as columns") and
  exported constants (`export const defaultMaxItemsPerLeaf = 8`).
- Generic constraints over runtime checks: `<T extends Transform3D>`.
- The C# rule "validate constructor arguments eagerly and throw standard exceptions" does not
  transfer. `throw` is banned outside the Root and Test zones (PS-003). Instead: validate once
  at the edge where untrusted data enters (PS-043), and encode failure in the return type
  (PS-042). Inside the core, trust the types and write no defensive checks (PS-048).

## Chaining without extension methods

The C# style leans on extension methods for its pipeline feel:
`surface.ToQuadGrid(n).Triangulate().WeldVertices().FlipFaces()`. TypeScript has no extension
methods, and PS-002 rules out the fluent-wrapper-class alternative. Two options, in order of
preference:

1. **Subject-first functions plus one `pipe`.** Keep the direct function as the primitive and
   introduce a curried form only where chaining is actually used.

   ```ts
   export const pipe = <A>(value: A, ...steps: readonly ((a: A) => A)[]): A =>
     steps.reduce((accumulator, step) => step(accumulator), value)

   const mesh = pipe(toQuadGrid(surface, n), triangulate, weldVertices, flipFaces)
   ```

2. **Plain nesting** where the chain is two or three steps deep. `flipFaces(weldVertices(m))`
   is clearer than any machinery and needs no helper.

Do not build a general variadic type-changing `pipe`, a `flow`, or a composition library. One
monomorphic `pipe` and plain nesting cover the real cases; the rest is the no-speculative-
abstraction rule being broken with types instead of code.

## Performance-sensitive code

The C# escape hatch — tight indexed loops, preallocated buffers, no LINQ in hot paths — has a
direct TypeScript equivalent, and the same discipline applies: keep the imperative core private
to one file and wrap a clean functional surface around it. A local `let` and a local mutable
array inside a function that returns a frozen result is acceptable in that one file, documented
per PS-056, because the mutation is not observable to the caller. Everywhere else PS-020
(`const` only) and PS-052 (pipelines, not accumulators) hold. Measure first; premature
micro-optimization in cold code is the more common mistake.

## Comments and docs

- Most files have zero comments. The code should be self-explanatory.
- TSDoc (`/** … */`) only where behaviour is genuinely non-obvious: the contract of an exported
  type, an algorithm overview, the meaning of a unit or coordinate frame. Write intent and
  trade-offs, never a restatement of the signature.
- Short `//` comments are for the meaning of a field or a layout, never for narrating the next
  line. No history, no dates, no ticket numbers (PS-050).

## Error handling

- No exception hierarchy, and no `throw` at all outside Root and Test (PS-003).
- Failure is a value: a purpose-built discriminated union per module, not a general
  `Result<T, E>` with combinators (PS-042). Failures carry data; message strings are formatted
  at the Root, where the audience is known (PS-053).
- Prefer making invalid states unrepresentable — construction through a factory that can only
  produce valid values — over defensive checks scattered through the code.

## Testing and verification

- Vitest, in a `test/` directory parallel to `src/`. The C# split (an NUnit test project,
  BenchmarkDotNet in its own project) maps to tests under `test/` and benchmarks behind a
  separate entry point, never mixed.
- Favour exact structural assertions on small known inputs (a unit cube, a single quad, a
  three-line transcript) plus property-style checks (counts, bounds, invariants) on generated
  inputs.
- Test the exported contract, not the internals (PS-054).

## Things to avoid

- Classes, inheritance, `this`, and decorators.
- `Iterable<T>` or generator returns in public signatures; the multiple-enumeration trap is the
  one `IEnumerable<T>` sets.
- Mutable exported state; setters; objects handed out and then modified.
- `async` in core libraries. It belongs at the application edge, alongside IO (PS-044).
- Dependency-injection containers, decorator-driven frameworks, and runtime schema layers in
  core code.
- Over-commenting, TODO litter, and defensive `undefined` checks on non-optional parameters.
- Premature micro-optimization in cold code; premature abstraction anywhere.

## Quick template

```ts
export type Thing = { readonly points: readonly Point3D[] }

export const frobnicate = (thing: Thing, amount: number): Thing =>
  ({ points: thing.points.map(p => scale(p, amount)) })
```

When in doubt: make it immutable, make it an expression, make it composable.

## Where this draft diverges from the C# guide

| C# rule | TypeScript treatment | Why |
|---|---|---|
| Allman braces | K&R braces | Semicolon-insertion hazards; universal TypeScript expectation |
| Four-space indent | Two-space indent | Matches existing code here |
| Extension methods for chaining | Subject-first free functions plus one `pipe` | No extension methods; PS-002 rules out wrapper classes |
| Throw standard exceptions at boundaries | Failure encoded in the return type | PS-003, PS-042 |
| `sealed` classes, nested types | Discriminated unions, unexported module-local types | No classes |
| `readonly record struct` | `readonly` type alias plus factory function | No value types |
| `var` everywhere | `const` everywhere; `let` only in Root and hot-path interiors | PS-020 |
| `IReadOnlyList<T>` | `readonly T[]` | Nearest equivalent |
| `_camelCase` private fields | Unexported module bindings | No fields |

## Open questions

1. Should the roughly 100-line file target from the C# guide be adopted as a Tier 2 rule
   alongside the existing 300-line cap (PS-024)? The C# codebase is meaningfully denser.
2. Does the `pipe` helper earn its place, or is plain nesting enough for everything here today?
   PS-051 says delete it until a call site needs it.
3. "Every function is a public API" implies a documentation standard that the near-zero-comment
   rule pushes against. In C# the resolution is that the signature is the documentation. Worth
   stating as an explicit rule rather than leaving implicit.
4. Should the subject-first parameter convention get its own Tier 2 rule ID? It is mechanically
   checkable for functions in a module named after a type.
