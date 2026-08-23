// Hand-rolled inline-SVG pie-chart geometry (BL-0013). No charting library — zero
// external requests, matches ui.ts's constraint. This module is the tested source
// of truth for the arc math; the client script in ui.ts embeds an equivalent plain
// JS implementation (it runs in the browser against live SSE data and cannot
// import an ES module), so keep the two in sync when the formula changes.

// Input slice for pie chart rendering.
export type PieSlice = {
  readonly label: string
  readonly value: number
  readonly color: string
}

// SVG arc path and metadata for a pie chart slice.
export type PieArc = {
  readonly slice: PieSlice
  readonly startAngle: number
  readonly endAngle: number
  readonly path: string
}

const TAU = Math.PI * 2

const arcPoint = (
  cx: number,
  cy: number,
  r: number,
  angle: number,
): { readonly x: number; readonly y: number } => ({
  x: cx + r * Math.sin(angle),
  y: cy - r * Math.cos(angle),
})

// Pure. Angles are radians, clockwise from 12 o'clock. Only positive-value slices
// contribute; their angles sum to 2*PI. Returns [] when there is nothing to draw
// (empty input or every value zero/negative).
export const computePieArcs = (slices: readonly PieSlice[], size: number): readonly PieArc[] => {
  const positive = slices.filter((s) => s.value > 0)
  const total = positive.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return []

  const cx = size / 2
  const cy = size / 2
  const r = size / 2

  const cumulative = positive.reduce<readonly number[]>((acc, s) => {
    const prev = acc[acc.length - 1] ?? 0
    return [...acc, prev + s.value]
  }, [])

  return positive.map((slice, i): PieArc => {
    const before = i === 0 ? 0 : (cumulative[i - 1] ?? 0)
    const after = cumulative[i] ?? total
    const startAngle = (before / total) * TAU
    const endAngle = (after / total) * TAU
    const sweep = endAngle - startAngle

    // A single full-total slice can't be drawn as one SVG arc (start === end point),
    // so draw it as two half-circle arcs meeting at the opposite side.
    const path =
      positive.length === 1
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
        : (() => {
            const start = arcPoint(cx, cy, r, startAngle)
            const end = arcPoint(cx, cy, r, endAngle)
            const largeArc = sweep > Math.PI ? 1 : 0
            return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
          })()

    return { slice, startAngle, endAngle, path }
  })
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => {
    const table: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return table[c] ?? c
  })

// Pure. Full standalone <svg> markup for a set of slices; a neutral ring outline
// when there is nothing positive to draw.
export const pieSvg = (slices: readonly PieSlice[], size = 120): string => {
  const arcs = computePieArcs(slices, size)
  const r = size / 2
  if (arcs.length === 0) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="no data"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="none" stroke="#263043" stroke-width="2" /></svg>`
  }
  const paths = arcs
    .map(
      (arc) =>
        `<path d="${arc.path}" fill="${escapeXml(arc.slice.color)}"><title>${escapeXml(arc.slice.label)}</title></path>`,
    )
    .join('')
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${paths}</svg>`
}

// A small fixed palette (no charting-lib default to draw from). Cycles if there
// are more slices than colors.
export const PIE_PALETTE: readonly string[] = [
  '#8ab4f8',
  '#7ee787',
  '#f0883e',
  '#f778ba',
  '#79c0ff',
  '#d2a8ff',
  '#ffa657',
  '#a5d6ff',
]

// Maps an index to a palette color, wrapping if the index exceeds palette length.
export const colorForIndex = (index: number): string => PIE_PALETTE[index % PIE_PALETTE.length] ?? '#6b7793'
