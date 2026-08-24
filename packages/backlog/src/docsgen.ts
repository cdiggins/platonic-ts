// Pure half of `npm run docs:regen`: renders the inventory tables (npm scripts, workspace
// packages, vendored skills) and splices them into a document's generated marker blocks.

// One root-package.json script paired with the description that documents it.
export type ScriptEntry = {
  readonly name: string
  readonly command: string
  readonly description: string
}

// One workspace package: its directory under `packages/`, its npm name, and its manifest
// `description` field.
export type PackageEntry = {
  readonly dir: string
  readonly name: string
  readonly description: string
}

// One skill vendored into `.claude/skills/`, as named by its SKILL.md frontmatter.
export type SkillEntry = {
  readonly name: string
  readonly description: string
}

// Everything the generated blocks are rendered from. Nothing else may feed them: a fact that
// is not in one of these three manifests stays hand-written prose outside the markers.
export type DocsSources = {
  readonly scripts: readonly ScriptEntry[]
  readonly packages: readonly PackageEntry[]
  readonly skills: readonly SkillEntry[]
}

// A generated region found in a document: the name from its BEGIN marker and the raw text
// between the two markers, trailing line break included.
export type MarkerBlock = {
  readonly name: string
  readonly body: string
}

const beginMarker = (name: string): string =>
  `<!-- BEGIN GENERATED: ${name} (npm run docs:regen) -->`

const endMarker = '<!-- END GENERATED -->'

// A fresh regex per call: a global regex carries `lastIndex` between uses, so sharing one
// would make results depend on call order.
const markerRegex = (): RegExp =>
  /<!-- BEGIN GENERATED: ([A-Za-z0-9-]+) \(npm run docs:regen\) -->\r?\n([\s\S]*?)<!-- END GENERATED -->/g

const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n')

// The line ending a rewritten block must use so a regenerated file stays single-flavoured.
// The working tree is checked out with CRLF on Windows, so this cannot be assumed.
export const detectEol = (md: string): string => (md.includes('\r\n') ? '\r\n' : '\n')

// Every generated block present in the document, in document order.
export const extractMarkers = (md: string): readonly MarkerBlock[] =>
  [...md.matchAll(markerRegex())].map((match) => ({ name: match[1] ?? '', body: match[2] ?? '' }))

// Replaces the body of each named block with its generated content, leaving every other
// byte — including blocks with no matching generator — untouched. Idempotent: the output it
// writes is the input it would read back.
export const spliceBlocks = (md: string, blocks: ReadonlyMap<string, string>): string => {
  const eol = detectEol(md)
  return md.replace(markerRegex(), (match: string, name: string) => {
    const content = blocks.get(name)
    if (content === undefined) return match
    const body = `${content.split('\n').join(eol)}${eol}`
    return `${beginMarker(name)}${eol}${body}${endMarker}`
  })
}

// Names of blocks in the document whose committed body is not what regeneration would
// write — the staleness the check gate fails on.
export const staleBlockNames = (
  md: string,
  blocks: ReadonlyMap<string, string>,
): readonly string[] =>
  extractMarkers(md)
    .filter((block) => {
      const content = blocks.get(block.name)
      return content !== undefined && normalizeEol(block.body) !== `${content}\n`
    })
    .map((block) => block.name)

// Names of markers no generator produces — a typo or a renamed block, which would otherwise
// sit in the document forever without anyone maintaining it.
export const unknownBlockNames = (
  md: string,
  blocks: ReadonlyMap<string, string>,
): readonly string[] =>
  extractMarkers(md)
    .filter((block) => !blocks.has(block.name))
    .map((block) => block.name)

// A cell may not carry a raw pipe: markdown would read it as a column break.
const escapeCell = (text: string): string => text.replace(/\|/g, '\\|')

const renderTable = (
  header: readonly [string, string],
  rows: readonly (readonly [string, string])[],
): string =>
  [
    `| ${header[0]} | ${header[1]} |`,
    '|---|---|',
    ...rows.map(([name, description]) => `| ${name} | ${escapeCell(description)} |`),
  ].join('\n')

// The lead sentence of a skill description. A SKILL.md description also lists the phrases
// that trigger the skill, which is loader input rather than something a reader needs.
export const firstSentence = (text: string): string => {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/)
  return (match?.[0] ?? text).trim()
}

// Reads `name` and `description` out of a SKILL.md YAML frontmatter block. Returns undefined
// when either is absent, so a malformed skill is skipped rather than listed blank.
export const parseSkillFrontmatter = (content: string): SkillEntry | undefined => {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (frontmatter === undefined) return undefined
  const field = (key: string): string | undefined =>
    frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim()
  const name = field('name')
  const description = field('description')
  if (name === undefined || name === '' || description === undefined || description === '') {
    return undefined
  }
  return { name, description: firstSentence(description) }
}

// The full set of generated blocks, keyed by marker name. A document gets a block by naming
// it in a marker; the same block may appear in more than one document.
export const buildBlocks = (sources: DocsSources): ReadonlyMap<string, string> =>
  new Map([
    [
      'npm-scripts',
      renderTable(
        ['Command', 'What it does'],
        sources.scripts.map((script) => [`\`npm run ${script.name}\``, script.description] as const),
      ),
    ],
    [
      'packages',
      renderTable(
        ['Package', 'What it does'],
        sources.packages.map((pkg) => [`\`packages/${pkg.dir}\``, pkg.description] as const),
      ),
    ],
    [
      'skills',
      renderTable(
        ['Skill', 'What it does'],
        sources.skills.map((skill) => [`\`${skill.name}\``, skill.description] as const),
      ),
    ],
  ])

// Sources with nothing honest to print. Regeneration fails on these rather than emitting an
// empty cell, which is how a new script or package gets documented at the moment it is added.
export const missingDescriptions = (sources: DocsSources): readonly string[] => [
  ...sources.scripts.filter((s) => s.description === '').map((s) => `npm run ${s.name}`),
  ...sources.packages.filter((p) => p.description === '').map((p) => `packages/${p.dir}`),
  ...sources.skills.filter((s) => s.description === '').map((s) => `skill ${s.name}`),
]
