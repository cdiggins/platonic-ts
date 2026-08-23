// Seeing an edit before running it. The line diff is written here rather than
// taken from a package because this repository has no runtime dependencies: a
// longest-common-subsequence over lines, with the common prefix and suffix
// trimmed off first, is short and is exact on the cases a plan produces. The
// walk is recursive and builds its result by spreading, which is quadratic in
// the size of the changed region — fine for one file's worth of edits, and the
// reason the prefix/suffix trim happens first.
import { applyEdits, editsByFile, type EditPlan, type FileEdit } from './edit.ts'
import type { ToolOutput } from './query.ts'
import { sourceOf, type Workspace } from './workspace.ts'

type DiffKind = ' ' | '-' | '+'

type DiffOp = { readonly kind: DiffKind; readonly text: string }

type Position = { readonly a: number; readonly b: number }

const NO_NEWLINE = '\\ No newline at end of file'

// An empty file has no lines; every other text has one line per separator, and
// a trailing separator does not open a further line.
const splitLines = (text: string): readonly string[] => {
  if (text === '') return []
  const parts = text.split('\n')
  return parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts
}

const lacksFinalNewline = (text: string): boolean => text !== '' && !text.endsWith('\n')

const commonPrefix = (a: readonly string[], b: readonly string[]): number => {
  const limit = Math.min(a.length, b.length)
  const index = a.findIndex((line, position) => position >= limit || b[position] !== line)
  return index === -1 ? limit : index
}

const commonSuffix = (a: readonly string[], b: readonly string[], prefix: number): number => {
  const limit = Math.min(a.length, b.length) - prefix
  const offsets = Array.from({ length: limit }, (_, offset) => offset)
  const index = offsets.findIndex(
    (offset) => a[a.length - 1 - offset] !== b[b.length - 1 - offset],
  )
  return index === -1 ? limit : index
}

// table[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
const lcsTable = (
  a: readonly string[],
  b: readonly string[],
): readonly (readonly number[])[] => {
  const zeros: readonly number[] = Array.from({ length: b.length + 1 }, () => 0)
  return a.reduceRight<readonly (readonly number[])[]>((rows, line) => {
    const next = rows[0] ?? zeros
    const row = b.reduceRight<readonly number[]>(
      (built, other, column) => [
        line === other
          ? (next[column + 1] ?? 0) + 1
          : Math.max(next[column] ?? 0, built[0] ?? 0),
        ...built,
      ],
      [0],
    )
    return [row, ...rows]
  }, [zeros])
}

// Deletions come out before insertions on a tie, which is what diff(1) prints
// for a replaced block.
const walk = (
  a: readonly string[],
  b: readonly string[],
  table: readonly (readonly number[])[],
  i: number,
  j: number,
): readonly DiffOp[] => {
  if (i >= a.length && j >= b.length) return []
  if (i < a.length && j < b.length && a[i] === b[j])
    return [{ kind: ' ', text: a[i] ?? '' }, ...walk(a, b, table, i + 1, j + 1)]
  const down = table[i + 1]?.[j] ?? 0
  const right = table[i]?.[j + 1] ?? 0
  return i < a.length && (j >= b.length || down >= right)
    ? [{ kind: '-', text: a[i] ?? '' }, ...walk(a, b, table, i + 1, j)]
    : [{ kind: '+', text: b[j] ?? '' }, ...walk(a, b, table, i, j + 1)]
}

const context = (lines: readonly string[]): readonly DiffOp[] =>
  lines.map((text) => ({ kind: ' ', text }))

// Two texts that differ only in their final newline split into identical line
// arrays, so the final shared line has to be reported as a replacement or the
// difference disappears.
const splitFinal = (ops: readonly DiffOp[]): readonly DiffOp[] => {
  const last = ops[ops.length - 1]
  return last === undefined || last.kind !== ' '
    ? ops
    : [...ops.slice(0, -1), { kind: '-', text: last.text }, { kind: '+', text: last.text }]
}

const diffLines = (a: readonly string[], b: readonly string[]): readonly DiffOp[] => {
  const prefix = commonPrefix(a, b)
  const suffix = commonSuffix(a, b, prefix)
  const head = a.slice(prefix, a.length - suffix)
  const tail = b.slice(prefix, b.length - suffix)
  return [
    ...context(a.slice(0, prefix)),
    ...walk(head, tail, lcsTable(head, tail), 0, 0),
    ...context(a.slice(a.length - suffix)),
  ]
}

// positions[i] counts the lines of each side consumed before op i.
const positionsOf = (ops: readonly DiffOp[]): readonly Position[] =>
  ops.reduce<readonly Position[]>(
    (built, op) => {
      const last = built[built.length - 1] ?? { a: 0, b: 0 }
      return [
        ...built,
        { a: last.a + (op.kind === '+' ? 0 : 1), b: last.b + (op.kind === '-' ? 0 : 1) },
      ]
    },
    [{ a: 0, b: 0 }],
  )

const mergeRanges = (
  ranges: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] =>
  ranges.reduce<readonly (readonly [number, number])[]>((built, range) => {
    const previous = built[built.length - 1]
    return previous !== undefined && range[0] <= previous[1] + 1
      ? [...built.slice(0, -1), [previous[0], Math.max(previous[1], range[1])]]
      : [...built, range]
  }, [])

const rangeText = (start: number, count: number): string =>
  count === 0 ? `${start - 1},0` : count === 1 ? `${start}` : `${start},${count}`

// Format a diff between two strings as unified diff hunks with context lines.
export const unifiedDiff = (
  file: string,
  before: string,
  after: string,
  contextLines: number,
): string => {
  if (before === after) return ''
  const a = splitLines(before)
  const b = splitLines(after)
  const aOpen = lacksFinalNewline(before)
  const bOpen = lacksFinalNewline(after)
  const ops = aOpen === bOpen ? diffLines(a, b) : splitFinal(diffLines(a, b))
  const positions = positionsOf(ops)
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]))
  if (changed.length === 0) return ''
  const hunks = mergeRanges(
    changed.map((index): readonly [number, number] => [
      Math.max(0, index - contextLines),
      Math.min(ops.length - 1, index + contextLines),
    ]),
  )
  const marked = (op: DiffOp, index: number): readonly string[] => {
    const at = positions[index] ?? { a: 0, b: 0 }
    const lastA = op.kind !== '+' && at.a + 1 === a.length && aOpen
    const lastB = op.kind !== '-' && at.b + 1 === b.length && bOpen
    const open = op.kind === ' ' ? lastA && lastB : lastA || lastB
    return open ? [`${op.kind}${op.text}`, NO_NEWLINE] : [`${op.kind}${op.text}`]
  }
  const body = hunks.flatMap(([low, high]) => {
    const window = ops.slice(low, high + 1)
    const at = positions[low] ?? { a: 0, b: 0 }
    const aCount = window.filter((op) => op.kind !== '+').length
    const bCount = window.filter((op) => op.kind !== '-').length
    return [
      `@@ -${rangeText(at.a + 1, aCount)} +${rangeText(at.b + 1, bCount)} @@`,
      ...window.flatMap((op, offset) => marked(op, low + offset)),
    ]
  })
  return [`--- ${file}`, `+++ ${file}`, ...body].join('\n')
}

const PREVIEW_CONTEXT = 3

type FilePreview = { readonly ok: boolean; readonly text: string }

const previewFile = (
  workspace: Workspace,
  file: string,
  edits: readonly FileEdit[],
): FilePreview => {
  const source = sourceOf(workspace, file)
  if (source === undefined) return { ok: false, text: `${file} is not indexed.` }
  const diff = unifiedDiff(file, source.text, applyEdits(source.text, edits), PREVIEW_CONTEXT)
  return { ok: true, text: diff === '' ? `${file} — no change` : diff }
}

// A plan that will not run previews as the reason it will not run: the caller
// asked what would happen, and nothing happening is the answer.
export const previewPlan = (workspace: Workspace, plan: EditPlan): ToolOutput => {
  if (!plan.ok) return { ok: false, text: plan.text }
  const previews = [...editsByFile(plan.edits).entries()].map(([file, edits]) =>
    previewFile(workspace, file, edits),
  )
  const failures = previews.filter((preview) => !preview.ok)
  return failures.length > 0
    ? { ok: false, text: failures.map((preview) => preview.text).join('\n') }
    : { ok: true, text: [plan.summary, ...previews.map((preview) => preview.text)].join('\n\n') }
}
