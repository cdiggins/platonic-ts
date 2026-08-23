// Pagination for the dashboard's tables. This module is the tested source of
// truth for the page arithmetic; the client script it exports embeds an
// equivalent plain JS implementation (it runs in the browser against live SSE
// data and cannot import an ES module), so keep the two in sync when the
// arithmetic changes.

// Input to pagination: total row count, desired page number, and rows per page.
export type PageRequest = {
  readonly total: number
  readonly page: number
  // Rows per page. Zero means "no paging": one page holding everything.
  readonly size: number
}

// Result of pagination: page number, page count, row slice, and navigation flags.
export type Page = {
  readonly page: number
  readonly pageCount: number
  readonly start: number
  readonly end: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
}

// Available page sizes for tables; zero means show all rows.
export const PAGE_SIZES: readonly number[] = [10, 25, 50, 0]

// Default rows per page.
export const DEFAULT_PAGE_SIZE = 25

// Formats a page size for display: "25 per page" or "all".
export const pageSizeLabel = (size: number): string =>
  size === 0 ? 'all' : `${size} per page`

// Pure and total. `page` is zero-based and clamped into range, so a caller
// holding a stale page across a shrinking list lands on the last page rather
// than on an empty one. `start`/`end` are a half-open slice of the row list.
export const computePage = (request: PageRequest): Page => {
  const total = Math.max(0, Math.floor(request.total))
  const size = Math.max(0, Math.floor(request.size))
  const perPage = size === 0 ? Math.max(total, 1) : size
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(Math.floor(request.page), 0), pageCount - 1)
  const start = Math.min(page * perPage, total)
  return {
    page,
    pageCount,
    start,
    end: Math.min(start + perPage, total),
    hasPrevious: page > 0,
    hasNext: page < pageCount - 1,
  }
}

// "26-50 of 55", or "0 rows" when there is nothing to page through.
export const pageRangeLabel = (page: Page, total: number, noun: string): string =>
  total === 0 ? `0 ${noun}` : `${page.start + 1}-${page.end} of ${total}`

// Formats page number for display: "page N of M".
export const pageLabel = (page: Page): string => `page ${page.page + 1} of ${page.pageCount}`

const pageSizeOptionsHtml = PAGE_SIZES.map(
  (size) =>
    `<option value="${size}"${size === DEFAULT_PAGE_SIZE ? ' selected' : ''}>${pageSizeLabel(size)}</option>`,
).join('')

// Controls for one paged table. `prefix` namespaces the element ids so a page
// can hold several pagers; the same prefix goes to `createPager` client-side.
export const pagerMarkup = (prefix: string): string => `
    <div class="pager">
      <select id="${prefix}-page-size" class="range-select">
        ${pageSizeOptionsHtml}
      </select>
      <button type="button" id="${prefix}-previous" class="pager-button">&lsaquo; prev</button>
      <span class="muted" id="${prefix}-page"></span>
      <button type="button" id="${prefix}-next" class="pager-button">next &rsaquo;</button>
      <span class="muted" id="${prefix}-count"></span>
    </div>`

// CSS styles for pager controls.
export const pagerStyles = `
  .pager { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .pager-button {
    font-family: inherit;
    font-size: 12px;
    background: #161b22;
    color: #8ab4f8;
    border: 1px solid #263043;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .pager-button:hover:not(:disabled) { border-color: #8ab4f8; }
  .pager-button:disabled { color: #4b5468; cursor: default; }`

// Browser-side half. `createPager(prefix, noun, onChange)` wires the controls
// rendered by `pagerMarkup` and returns an object whose `slice(rows)` takes the
// full row list, updates the controls, and hands back the rows for the current
// page. `onChange` re-renders the table that owns the pager.
export const PAGER_CLIENT_SCRIPT = `
  function computePage(total, page, size) {
    var perPage = size === 0 ? Math.max(total, 1) : size;
    var pageCount = Math.max(1, Math.ceil(total / perPage));
    var clamped = Math.min(Math.max(page, 0), pageCount - 1);
    var start = Math.min(clamped * perPage, total);
    return {
      page: clamped,
      pageCount: pageCount,
      start: start,
      end: Math.min(start + perPage, total),
      hasPrevious: clamped > 0,
      hasNext: clamped < pageCount - 1
    };
  }

  function createPager(prefix, noun, onChange) {
    var element = function (suffix) { return document.getElementById(prefix + '-' + suffix); };
    var page = 0;
    var sizeSelect = element('page-size');
    var previous = element('previous');
    var next = element('next');

    function step(delta) {
      page = Math.max(0, page + delta);
      onChange();
    }

    if (sizeSelect) sizeSelect.addEventListener('change', function () { page = 0; onChange(); });
    if (previous) previous.addEventListener('click', function () { step(-1); });
    if (next) next.addEventListener('click', function () { step(1); });

    return {
      slice: function (rows) {
        var size = sizeSelect ? Number(sizeSelect.value) : ${DEFAULT_PAGE_SIZE};
        var current = computePage(rows.length, page, size);
        page = current.page;
        var countEl = element('count');
        if (countEl) {
          countEl.textContent = rows.length === 0
            ? '0 ' + noun
            : (current.start + 1) + '-' + current.end + ' of ' + rows.length;
        }
        var pageEl = element('page');
        if (pageEl) pageEl.textContent = 'page ' + (current.page + 1) + ' of ' + current.pageCount;
        if (previous) previous.disabled = !current.hasPrevious;
        if (next) next.disabled = !current.hasNext;
        return rows.slice(current.start, current.end);
      }
    };
  }
`
