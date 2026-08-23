// Several symbol-addressed edits that are only correct together, applied all or
// nothing. Combining is pure: the check that the edits do not fight each other
// happens before anything is written, so a batch that cannot be applied
// cleanly is refused rather than half-run.
import type { EditPlan, FileEdit } from './edit.ts'
import { editsByFile } from './edit.ts'

// Half-open ranges, so an edit that ends where the next begins is fine. Two
// insertions at one offset are not: both are empty ranges at the same point and
// nothing in the plan says which text comes first.
const collides = (left: FileEdit, right: FileEdit): boolean =>
  (left.start < right.end && right.start < left.end) ||
  (left.start === right.start && left.start === left.end && right.start === right.end)

const byRange = (left: FileEdit, right: FileEdit): number =>
  left.start === right.start ? left.end - right.end : left.start - right.start

const collisionsIn = (file: string, edits: readonly FileEdit[]): readonly string[] => {
  const ordered = edits.slice().sort(byRange)
  return ordered.flatMap((left, index) =>
    ordered
      .slice(index + 1)
      .filter((right) => collides(left, right))
      .map(
        (right) =>
          `${file}: ${left.start}-${left.end} overlaps ${right.start}-${right.end}`,
      ),
  )
}

export const overlapping = (edits: readonly FileEdit[]): readonly string[] =>
  [...editsByFile(edits).entries()].flatMap(([file, grouped]) => collisionsIn(file, grouped))

// Every failure is reported, not the first: a caller fixing three problems
// wants all three in one round trip.
export const combinePlans = (plans: readonly EditPlan[]): EditPlan => {
  if (plans.length === 0) return { ok: false, text: 'no plans to combine.' }
  const failures = plans.flatMap((plan) => (plan.ok ? [] : [plan.text]))
  if (failures.length > 0)
    return {
      ok: false,
      text: [`${failures.length} of ${plans.length} plans failed:`, ...failures].join('\n'),
    }
  const planned = plans.flatMap((plan) => (plan.ok ? [plan] : []))
  const edits = planned.flatMap((plan) => plan.edits)
  const collisions = overlapping(edits)
  if (collisions.length > 0)
    return {
      ok: false,
      text: [`${collisions.length} overlapping edits:`, ...collisions].join('\n'),
    }
  return {
    ok: true,
    edits,
    summary: [
      `${plans.length} plans combined, ${edits.length} edits:`,
      ...planned.map((plan) => plan.summary),
    ].join('\n'),
  }
}
