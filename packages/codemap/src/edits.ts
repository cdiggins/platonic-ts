// Text ranges and what it means to apply them. A refactoring in this package is data — a
// list of ranges and their replacements — and this module is the only place that turns that
// data back into a string. Nothing here reads or writes a file: the caller supplies the text
// it wants edited, which is what makes a rewrite testable and a preview identical to the
// thing that would be written.
export type Splice = {
  readonly start: number
  // Equal to `start` for an insertion.
  readonly end: number
  readonly text: string
}

export type TextEdit = Splice & { readonly file: string }

// Applying can fail on edits that were built against a different version of the text, so it
// says so rather than producing a corrupted string (PS-042).
export type SpliceResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'overlapping' | 'out-of-range' }

const byStart = (left: Splice, right: Splice): number =>
  left.start - right.start || left.end - right.end

// Two insertions at one point are allowed and keep their given order; anything that would
// have two edits rewriting the same character is refused.
export const spliceText = (text: string, splices: readonly Splice[]): SpliceResult => {
  const ordered = [...splices].sort(byStart)
  const outOfRange = ordered.some(
    (splice) => splice.start < 0 || splice.end < splice.start || splice.end > text.length,
  )
  if (outOfRange) return { ok: false, reason: 'out-of-range' }
  const overlapping = ordered.some((splice, index) => {
    const previous = ordered[index - 1]
    return previous !== undefined && splice.start < previous.end
  })
  if (overlapping) return { ok: false, reason: 'overlapping' }
  return {
    ok: true,
    text: [...ordered]
      .reverse()
      .reduce(
        (current, splice) => current.slice(0, splice.start) + splice.text + current.slice(splice.end),
        text,
      ),
  }
}

export const editsFor = (edits: readonly TextEdit[], file: string): readonly Splice[] =>
  edits.filter((edit) => edit.file === file)

// The text `file` would have after this plan's edits. One file at a time, because a plan
// spanning three files is three independent rewrites.
export const applyEdits = (
  edits: readonly TextEdit[],
  file: string,
  text: string,
): SpliceResult => spliceText(text, editsFor(edits, file))

export const editedFiles = (edits: readonly TextEdit[]): readonly string[] => [
  ...new Set(edits.map((edit) => edit.file)),
]
