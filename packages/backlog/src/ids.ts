// Backlog id allocation — the pure half: how a number becomes a name, which
// numbers a set of filenames already uses, and what makes an allocation
// invalid. The concurrency-safe claim itself is filesystem work and lives in
// `io.ts`; this module is what that claim is reasoning about.
//
// Design (see docs/backlog-id-allocation-2026-08-23.md): every number ever
// handed out is recorded by an empty marker file in `backlog/.ids/`, created
// with exclusive-create so two processes can never claim the same one. Markers
// are permanent, so renaming or deleting a ticket never frees its number.

export const idDigits = 4

// Generated views live beside the items but are not items.
export const generatedViews: readonly string[] = ['BACKLOG.md', 'DONE.md']

export const formatBacklogId = (value: number): string =>
  `BL-${String(value).padStart(idDigits, '0')}`

export const formatMarkerName = (value: number): string => String(value).padStart(idDigits, '0')

// `BL-0025-slug.md`, `BL-0025.md`, and bare `BL-0025` all denote number 25.
const idPattern = /^BL-(\d{4,})(?=[-.]|$)/

const toNumber = (digits: string): number | undefined => {
  const parsed = Number.parseInt(digits, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const backlogIdNumber = (name: string): number | undefined => {
  const digits = name.match(idPattern)?.[1]
  return digits === undefined ? undefined : toNumber(digits)
}

export const markerNumber = (name: string): number | undefined =>
  /^\d{4,}$/.test(name) ? toNumber(name) : undefined

const numbersFrom = (
  names: readonly string[],
  read: (name: string) => number | undefined,
): readonly number[] =>
  names.flatMap((name) => {
    const value = read(name)
    return value === undefined ? [] : [value]
  })

export const usedNumbers = (filenames: readonly string[]): readonly number[] =>
  numbersFrom(filenames, backlogIdNumber)

export const markerNumbers = (filenames: readonly string[]): readonly number[] =>
  numbersFrom(filenames, markerNumber)

// Where to start probing. Correctness never depends on this being right — an
// exclusive-create claim decides — but starting above every number in use keeps
// the probe to a single attempt in the normal case.
export const firstFreeNumber = (used: readonly number[]): number =>
  used.reduce((highest, value) => (value > highest ? value : highest), 0) + 1

// ---------------------------------------------------------------------------
// Validation — catches the failure mode the allocator cannot: a ticket created
// by hand, outside the allocator, that collides with or misnames a number.
// ---------------------------------------------------------------------------

export type BacklogIdIssueKind =
  'duplicate-number' | 'unnumbered-file' | 'unparseable-file' | 'id-mismatch' | 'missing-marker'

export type BacklogIdIssue = {
  readonly kind: BacklogIdIssueKind
  readonly detail: string
}

// `frontmatterId` is undefined when the file has no parseable frontmatter —
// including the zero-byte file an allocator left behind when its caller died
// before writing any content.
export type BacklogFileInfo = {
  readonly filename: string
  readonly frontmatterId: string | undefined
}

const issue = (kind: BacklogIdIssueKind, detail: string): BacklogIdIssue => ({ kind, detail })

const duplicateIssues = (files: readonly BacklogFileInfo[]): readonly BacklogIdIssue[] => {
  const byNumber = files.reduce((groups: ReadonlyMap<number, readonly string[]>, file) => {
    const value = backlogIdNumber(file.filename)
    if (value === undefined) return groups
    return new Map([...groups, [value, [...(groups.get(value) ?? []), file.filename]]])
  }, new Map<number, readonly string[]>())

  return [...byNumber]
    .filter(([, names]) => names.length > 1)
    .map(([value, names]) =>
      issue(
        'duplicate-number',
        `${formatBacklogId(value)} used by ${names.length} files: ${names.join(', ')}`,
      ),
    )
}

// One number, three things that can be wrong with the file wearing it.
const fileIssues = (
  file: BacklogFileInfo,
  markers: ReadonlySet<number>,
): readonly BacklogIdIssue[] => {
  const value = backlogIdNumber(file.filename)
  if (value === undefined) {
    return [issue('unnumbered-file', `${file.filename} has no BL-NNNN prefix`)]
  }
  const expected = formatBacklogId(value)
  const naming =
    file.frontmatterId === undefined
      ? [issue('unparseable-file', `${file.filename} has no readable frontmatter id`)]
      : file.frontmatterId === expected
        ? []
        : [issue('id-mismatch', `${file.filename} declares id ${file.frontmatterId}`)]
  const claim = markers.has(value)
    ? []
    : [issue('missing-marker', `${expected} has no marker in .ids/ — created outside the allocator`)]
  return [...naming, ...claim]
}

export const validateBacklogIds = (
  files: readonly BacklogFileInfo[],
  markers: readonly string[],
): readonly BacklogIdIssue[] => {
  const items = files.filter((file) => !generatedViews.includes(file.filename))
  const claimed = new Set(markerNumbers(markers))
  return [...duplicateIssues(items), ...items.flatMap((file) => fileIssues(file, claimed))]
}
