import { describe, expect, it } from 'vitest'
import {
  computePage,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  pageLabel,
  pageRangeLabel,
  pageSizeLabel,
  pagerMarkup,
} from '../src/paging.ts'

describe('computePage', () => {
  it('slices the first page and reports what follows', () => {
    expect(computePage({ total: 55, page: 0, size: 25 })).toEqual({
      page: 0,
      pageCount: 3,
      start: 0,
      end: 25,
      hasPrevious: false,
      hasNext: true,
    })
  })

  it('slices a middle page', () => {
    expect(computePage({ total: 55, page: 1, size: 25 })).toMatchObject({
      start: 25,
      end: 50,
      hasPrevious: true,
      hasNext: true,
    })
  })

  it('leaves the last page short and marks it as the end', () => {
    expect(computePage({ total: 55, page: 2, size: 25 })).toMatchObject({
      start: 50,
      end: 55,
      hasPrevious: true,
      hasNext: false,
    })
  })

  it('treats size 0 as a single page holding everything', () => {
    expect(computePage({ total: 55, page: 0, size: 0 })).toEqual({
      page: 0,
      pageCount: 1,
      start: 0,
      end: 55,
      hasPrevious: false,
      hasNext: false,
    })
  })

  it('clamps a page past the end onto the last page', () => {
    expect(computePage({ total: 55, page: 99, size: 25 })).toMatchObject({
      page: 2,
      start: 50,
      end: 55,
    })
  })

  it('clamps a negative page onto the first', () => {
    expect(computePage({ total: 55, page: -3, size: 25 })).toMatchObject({ page: 0, start: 0 })
  })

  it('reports one empty page when there is nothing to show', () => {
    expect(computePage({ total: 0, page: 0, size: 25 })).toEqual({
      page: 0,
      pageCount: 1,
      start: 0,
      end: 0,
      hasPrevious: false,
      hasNext: false,
    })
  })

  it('holds one empty page when the list empties under a stale page', () => {
    expect(computePage({ total: 0, page: 4, size: 25 })).toMatchObject({ page: 0, start: 0, end: 0 })
  })

  it('makes a page per row when the size is 1', () => {
    expect(computePage({ total: 3, page: 1, size: 1 })).toMatchObject({
      pageCount: 3,
      start: 1,
      end: 2,
    })
  })

  it('fills the last page exactly when the total divides evenly', () => {
    expect(computePage({ total: 50, page: 1, size: 25 })).toMatchObject({
      pageCount: 2,
      end: 50,
      hasNext: false,
    })
  })

  it('never runs the slice past the total', () => {
    const page = computePage({ total: 7, page: 0, size: 25 })
    expect(page).toMatchObject({ pageCount: 1, start: 0, end: 7 })
  })

  it('floors fractional input rather than producing a fractional slice', () => {
    expect(computePage({ total: 10.7, page: 1.9, size: 5.5 })).toMatchObject({
      page: 1,
      pageCount: 2,
      start: 5,
      end: 10,
    })
  })

  it('treats a negative total as empty', () => {
    expect(computePage({ total: -5, page: 0, size: 25 })).toMatchObject({ pageCount: 1, end: 0 })
  })

  it('walks every row exactly once across the pages', () => {
    const rows = Array.from({ length: 55 }, (_, index) => index)
    const first = computePage({ total: rows.length, page: 0, size: 10 })
    const walked = Array.from({ length: first.pageCount }, (_, index) =>
      computePage({ total: rows.length, page: index, size: 10 }),
    ).flatMap((page) => rows.slice(page.start, page.end))
    expect(walked).toEqual(rows)
  })
})

describe('labels', () => {
  it('renders a one-based inclusive range', () => {
    expect(pageRangeLabel(computePage({ total: 55, page: 1, size: 25 }), 55, 'agents')).toBe(
      '26-50 of 55',
    )
  })

  it('names the noun when there is nothing to page', () => {
    expect(pageRangeLabel(computePage({ total: 0, page: 0, size: 25 }), 0, 'agents')).toBe(
      '0 agents',
    )
  })

  it('renders a one-based page counter', () => {
    expect(pageLabel(computePage({ total: 55, page: 2, size: 25 }))).toBe('page 3 of 3')
  })

  it('labels size 0 as all', () => {
    expect(pageSizeLabel(0)).toBe('all')
    expect(pageSizeLabel(25)).toBe('25 per page')
  })
})

describe('pagerMarkup', () => {
  it('namespaces every control by the given prefix', () => {
    const markup = pagerMarkup('docs')
    for (const suffix of ['page-size', 'previous', 'next', 'page', 'count']) {
      expect(markup).toContain(`id="docs-${suffix}"`)
    }
  })

  it('offers every page size and preselects the default', () => {
    const markup = pagerMarkup('agents')
    for (const size of PAGE_SIZES) {
      expect(markup).toContain(`value="${size}"`)
    }
    expect(markup).toContain(`value="${DEFAULT_PAGE_SIZE}" selected`)
  })
})
