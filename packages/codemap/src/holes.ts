// Deciding which of a shape's holes become parameters, and what to call them.
//
// A hole is a name the expression reads without binding. Two things can be true of one:
// every occurrence spells it the same way, and it resolves above the expression in every
// file. Only when both hold can the extracted declaration read the name directly instead of
// being handed it — that is an import, a module-level helper, or a global. Everything else
// is a parameter, including a name that is spelled the same everywhere but is local, since
// the declaration will not be inside that local scope any more.
import ts from 'typescript'
import { resolutionOf } from './scope.ts'
import type { Site } from './sites.ts'
import { subtreeNodes } from './walk.ts'

export type ExtractedParameter = {
  readonly name: string
  // Which hole of the shared shape this parameter fills.
  readonly hole: number
  // Omitted when no type checker was supplied.
  readonly type: string | undefined
  // What each occurrence passes, in the group's occurrence order.
  readonly arguments: readonly string[]
}

export type HoleSplit = {
  // Names the body keeps reading directly, in hole order.
  readonly kept: readonly string[]
  readonly parameters: readonly ExtractedParameter[]
}

const nameAt = (site: Site, hole: number): string => site.names[hole] ?? ''

const isAmbient = (hole: number, sites: readonly Site[]): boolean => {
  const names = sites.map((site) => nameAt(site, hole))
  const first = names[0]
  if (first === undefined || first === '' || names.some((name) => name !== first)) return false
  return sites.every((site) => {
    const resolution = resolutionOf(first, site.node, site.scope)
    return resolution === 'module' || resolution === 'global'
  })
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

// Literal types are widened: an argument that happens to be `0` at one site is a `number`
// parameter, not a parameter that only accepts zero.
export const typeText = (
  checker: ts.TypeChecker | undefined,
  node: ts.Node,
): string | undefined =>
  checker === undefined
    ? undefined
    : checker.typeToString(
        checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(node)),
        node,
        ts.TypeFormatFlags.NoTruncation,
      )

const identifierAt = (site: Site, start: number): ts.Node | undefined =>
  subtreeNodes(site.node).find(
    (node) => ts.isIdentifier(node) && node.getStart(site.entry.sourceFile) === start,
  )

// One type per occurrence, joined when they differ: a parameter that is a string at one site
// and a number at another is genuinely both, and saying so beats picking one.
const parameterType = (
  hole: number,
  sites: readonly Site[],
  checker: ts.TypeChecker | undefined,
): string | undefined => {
  if (checker === undefined) return undefined
  const texts = sites.flatMap((site) => {
    const reference = site.references.find((candidate) => candidate.hole === hole)
    const node = reference === undefined ? undefined : identifierAt(site, reference.start)
    const text = node === undefined ? undefined : typeText(checker, node)
    return text === undefined ? [] : [text]
  })
  const distinct = [...new Set(texts)]
  if (distinct.length === 0) return undefined
  // A top type absorbs the rest: a parameter that must accept an `unknown` accepts anything,
  // and `unknown | string` is a longer way of writing the same constraint.
  if (distinct.includes('unknown')) return 'unknown'
  return distinct.includes('any') ? 'any' : distinct.join(' | ')
}

// ---------------------------------------------------------------------------
// Names.
// ---------------------------------------------------------------------------

// The name most occurrences use, so the parameter reads like the code it came from. Ties go
// to the first occurrence, which is also the one whose text becomes the body.
const mostCommon = (names: readonly string[]): string => {
  const count = (name: string): number => names.filter((other) => other === name).length
  return (
    [...names].sort(
      (left, right) => count(right) - count(left) || names.indexOf(left) - names.indexOf(right),
    )[0] ?? 'value'
  )
}

// Every name the body still contains after the parameterized reads are replaced. A parameter
// may not collide with one of them, or it would capture a binding the body already has.
const takenNames = (template: Site, holes: readonly number[]): ReadonlySet<string> => {
  const replaced = new Set(holes.map((hole) => nameAt(template, hole)))
  return new Set(
    subtreeNodes(template.node)
      .flatMap((node) => (ts.isIdentifier(node) ? [node.text] : []))
      .filter((name) => !replaced.has(name)),
  )
}

const freshName = (base: string, taken: ReadonlySet<string>): string => {
  const attempt = (suffix: number): string => {
    const candidate = suffix === 1 ? base : `${base}${suffix}`
    return taken.has(candidate) ? attempt(suffix + 1) : candidate
  }
  return attempt(1)
}

// ---------------------------------------------------------------------------
// The split.
// ---------------------------------------------------------------------------

// `sites` are the occurrences of one shape, the first of which supplies the body.
export const splitHoles = (
  sites: readonly Site[],
  checker: ts.TypeChecker | undefined,
): HoleSplit => {
  const template = sites[0]
  if (template === undefined) return { kept: [], parameters: [] }
  const holes = template.names.map((_name, hole) => hole)
  const ambient = holes.filter((hole) => isAmbient(hole, sites))
  const parameterized = holes.filter((hole) => !ambient.includes(hole))
  const parameters = parameterized.reduce<readonly ExtractedParameter[]>((chosen, hole) => {
    const taken = new Set([
      ...takenNames(template, parameterized),
      ...chosen.map((parameter) => parameter.name),
    ])
    return [
      ...chosen,
      {
        name: freshName(mostCommon(sites.map((site) => nameAt(site, hole))), taken),
        hole,
        type: parameterType(hole, sites, checker),
        arguments: sites.map((site) => nameAt(site, hole)),
      },
    ]
  }, [])
  return { kept: ambient.map((hole) => nameAt(template, hole)), parameters }
}
