// Single-page dashboard HTML. All CSS/JS inline, zero external requests.
// Client connects to /api/events (SSE) and renders on every push.

import { DEFAULT_USAGE_RANGE, USAGE_RANGES, usageRangeLabel } from './range.ts'
import { PIE_PALETTE } from './pie.ts'

const pieColorsJson = JSON.stringify(PIE_PALETTE)

const rangeOptionsHtml = USAGE_RANGES.map(
  (r) =>
    `<option value="${r}"${r === DEFAULT_USAGE_RANGE ? ' selected' : ''}>${usageRangeLabel(r)}</option>`,
).join('')

const clientScript = `
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function formatNumber(n) {
    return Math.round(n).toLocaleString('en-US');
  }
  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return formatNumber(n);
  }
  function shortModel(m) {
    if (!m) return '-';
    return m.indexOf('claude-') === 0 ? m.slice('claude-'.length) : m;
  }
  function relativeTime(ts, now) {
    var diff = Math.max(0, now - ts);
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's ago';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    return day + 'd ago';
  }
  function formatBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  var STATUS_ORDER = ['in-progress', 'ready', 'done', 'dropped'];
  var ALL_STATUSES = ['idea', 'ready', 'in-progress', 'done', 'dropped'];

  // ---------------------------------------------------------------------
  // Pie charts (BL-0013). Hand-rolled inline SVG, no library. The arc math
  // mirrors packages/dashboard/src/pie.ts's computePieArcs/pieSvg exactly —
  // that TS module is the tested source of truth for the formula; this copy
  // exists because an inline <script> cannot import an ES module.
  // ---------------------------------------------------------------------
  var PIE_COLORS = ${pieColorsJson};

  function pieColorForIndex(i) {
    return PIE_COLORS[i % PIE_COLORS.length];
  }

  function pieArcPoint(cx, cy, r, angle) {
    return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
  }

  function pieSvg(slices, size) {
    size = size || 120;
    var positive = slices.filter(function (s) { return s.value > 0; });
    var total = positive.reduce(function (sum, s) { return sum + s.value; }, 0);
    var r = size / 2;
    var cx = size / 2;
    var cy = size / 2;
    if (total <= 0) {
      return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="no data"><circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 2) + '" fill="none" stroke="#263043" stroke-width="2" /></svg>';
    }
    var angle = 0;
    var paths = positive.map(function (slice) {
      var sweep = (slice.value / total) * Math.PI * 2;
      var startAngle = angle;
      var endAngle = angle + sweep;
      angle = endAngle;
      var d;
      if (positive.length === 1) {
        d = 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 1 1 ' + cx + ' ' + (cy + r) + ' A ' + r + ' ' + r + ' 0 1 1 ' + cx + ' ' + (cy - r) + ' Z';
      } else {
        var start = pieArcPoint(cx, cy, r, startAngle);
        var end = pieArcPoint(cx, cy, r, endAngle);
        var largeArc = sweep > Math.PI ? 1 : 0;
        d = 'M ' + cx + ' ' + cy + ' L ' + start.x + ' ' + start.y + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + end.x + ' ' + end.y + ' Z';
      }
      return '<path d="' + d + '" fill="' + slice.color + '"><title>' + escapeHtml(slice.label) + '</title></path>';
    }).join('');
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">' + paths + '</svg>';
  }

  function pieLegendHtml(slices) {
    return slices
      .filter(function (s) { return s.value > 0; })
      .map(function (s) {
        return '<div class="pie-legend-row"><span class="pie-swatch" style="background:' + s.color + '"></span>' + escapeHtml(s.label) + ' <span class="muted">' + formatTokens(s.value) + '</span></div>';
      })
      .join('');
  }

  function renderPieChart(containerId, slices) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div class="pie-chart">' + pieSvg(slices, 100) + '<div class="pie-legend">' + pieLegendHtml(slices) + '</div></div>';
  }

  function initDocsToggle() {
    var toggle = document.getElementById('docs-toggle');
    var content = document.getElementById('docs-explanation');
    if (toggle && content) {
      toggle.addEventListener('click', function () {
        var isOpen = content.classList.contains('open');
        if (isOpen) {
          content.classList.remove('open');
          toggle.textContent = '+ How the dashboard works';
        } else {
          content.classList.add('open');
          toggle.textContent = '- How the dashboard works';
        }
      });
    }
  }

  function render(snapshot) {
    var now = Date.now();
    document.getElementById('last-update').textContent = new Date(snapshot.generatedAt).toLocaleTimeString();
    document.getElementById('tpm').textContent = formatTokens(Math.round(snapshot.usage.outputTokensPerMinute));

    var agentsBody = document.querySelector('#agents-table tbody');
    agentsBody.innerHTML = '';
    if (snapshot.agents.length === 0) {
      agentsBody.innerHTML = '<tr><td colspan="8" class="empty">no agents</td></tr>';
    }
    snapshot.agents.forEach(function (a) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="dot ' + (a.active ? 'active' : 'inactive') + '"></span></td>' +
        '<td>' + escapeHtml(a.label) + (a.isSidechain ? '<span class="badge">sidechain</span>' : '') + '</td>' +
        '<td>' + escapeHtml(shortModel(a.lastModel)) + '</td>' +
        '<td>' + escapeHtml(a.lastTool || '-') + '</td>' +
        '<td class="wrap">' + escapeHtml(a.lastSnippet || '-') + '</td>' +
        '<td>' + formatTokens(a.totalInputTokens) + '</td>' +
        '<td>' + formatTokens(a.totalOutputTokens) + '</td>' +
        '<td>' + relativeTime(a.lastActivityAt, now) + '</td>';
      agentsBody.appendChild(tr);
    });

    var u = snapshot.usage;
    var totalsEl = document.getElementById('usage-totals');
    totalsEl.innerHTML =
      '<div class="stat"><div class="label">in</div><div class="value">' + formatNumber(u.totalInputTokens) + '</div></div>' +
      '<div class="stat"><div class="label">out</div><div class="value">' + formatNumber(u.totalOutputTokens) + '</div></div>' +
      '<div class="stat"><div class="label">cache read</div><div class="value">' + formatNumber(u.totalCacheReadTokens) + '</div></div>' +
      '<div class="stat"><div class="label">cache create</div><div class="value">' + formatNumber(u.totalCacheCreationTokens) + '</div></div>';

    var usageBody = document.querySelector('#usage-table tbody');
    usageBody.innerHTML = '';
    if (u.byModel.length === 0) {
      usageBody.innerHTML = '<tr><td colspan="6" class="empty">no usage</td></tr>';
    }
    u.byModel.forEach(function (m) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(shortModel(m.model)) + '</td>' +
        '<td>' + formatTokens(m.inputTokens) + '</td>' +
        '<td>' + formatTokens(m.outputTokens) + '</td>' +
        '<td>' + formatTokens(m.cacheReadTokens) + '</td>' +
        '<td>' + formatTokens(m.cacheCreationTokens) + '</td>' +
        '<td>' + formatNumber(m.messages) + '</td>';
      usageBody.appendChild(tr);
    });

    renderPieChart('usage-pie', u.byModel.map(function (m, i) {
      return { label: shortModel(m.model), value: m.outputTokens, color: pieColorForIndex(i) };
    }));

    renderPieChart('backlog-pie', ALL_STATUSES.map(function (status, i) {
      var count = snapshot.backlog.filter(function (b) { return b.status === status; }).length;
      return { label: status, value: count, color: pieColorForIndex(i) };
    }));

    var backlogEl = document.getElementById('backlog');
    backlogEl.innerHTML = '';
    if (snapshot.backlog.length === 0) {
      backlogEl.innerHTML = '<div class="empty">no backlog items</div>';
    }
    STATUS_ORDER.forEach(function (status) {
      var items = snapshot.backlog.filter(function (b) { return b.status === status; });
      if (items.length === 0) return;
      var group = document.createElement('div');
      group.className = 'status-group';
      var heading = document.createElement('h3');
      heading.textContent = status + ' (' + items.length + ')';
      group.appendChild(heading);
      var table = document.createElement('table');
      var tbody = document.createElement('tbody');
      items.forEach(function (item) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(item.id) + '</td>' +
          '<td>' + escapeHtml(item.title) + '</td>' +
          '<td>' + escapeHtml(item.type) + '</td>' +
          '<td class="pri">' + escapeHtml(item.priority) + '</td>' +
          '<td>' + escapeHtml(item.effort) + '</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      group.appendChild(table);
      backlogEl.appendChild(group);
    });

    var ideasEl = document.getElementById('ideas');
    ideasEl.innerHTML = '';
    var ideas = snapshot.backlog.filter(function (b) { return b.status === 'idea'; });
    if (ideas.length === 0) {
      ideasEl.innerHTML = '<div class="empty">no ideas</div>';
    } else {
      var ideasGroup = document.createElement('div');
      ideasGroup.className = 'status-group';
      var ideasTable = document.createElement('table');
      var ideasBody = document.createElement('tbody');
      ideas.forEach(function (item) {
        var tr = document.createElement('tr');
        tr.className = 'idea-row';
        tr.innerHTML =
          '<td>' + escapeHtml(item.id) + '</td>' +
          '<td>' + escapeHtml(item.title) + (item.area ? '<span class="badge">' + escapeHtml(item.area) + '</span>' : '') + '</td>' +
          '<td>' + escapeHtml(item.type) + '</td>' +
          '<td class="pri">' + escapeHtml(item.priority) + '</td>' +
          '<td>' + escapeHtml(item.effort) + '</td>';
        var detail = document.createElement('tr');
        detail.className = 'idea-detail';
        var fileLink = 'vscode://file/' + encodeURIComponent(item.file);
        detail.innerHTML =
          '<td colspan="5" class="wrap">' +
          '<div class="idea-meta"><a href="' + escapeHtml(fileLink) + '">' + escapeHtml(item.file) + '</a></div>' +
          '<pre class="idea-text">' + escapeHtml(item.body) + '</pre>' +
          '</td>';
        tr.addEventListener('click', function () {
          detail.classList.toggle('open');
          tr.classList.toggle('expanded');
        });
        ideasBody.appendChild(tr);
        ideasBody.appendChild(detail);
      });
      ideasTable.appendChild(ideasBody);
      ideasGroup.appendChild(ideasTable);
      ideasEl.appendChild(ideasGroup);
    }

    var docsBody = document.querySelector('#docs-table tbody');
    docsBody.innerHTML = '';
    if (snapshot.docs.length === 0) {
      docsBody.innerHTML = '<tr><td colspan="4" class="empty">no docs</td></tr>';
    }
    snapshot.docs.forEach(function (d) {
      var tr = document.createElement('tr');
      var fileLink = 'vscode://file/' + encodeURIComponent(d.file);
      tr.innerHTML =
        '<td><a href="' + escapeHtml(fileLink) + '" style="color: #8ab4f8; text-decoration: none;">' + escapeHtml(d.file) + '</a></td>' +
        '<td>' + escapeHtml(d.title) + '</td>' +
        '<td>' + relativeTime(d.modifiedAt, now) + '</td>' +
        '<td>' + formatBytes(d.sizeBytes) + '</td>';
      docsBody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------------
  // Recent tool + skill invocations (BL-0012). Polled separately from the SSE
  // snapshot stream via a same-origin fetch — not an external request, and
  // keeps the invocation ring buffer out of the per-tick SSE payload.
  // ---------------------------------------------------------------------
  function renderInvocations(invocations) {
    var body = document.querySelector('#invocations-table tbody');
    if (!body) return;
    body.innerHTML = '';
    if (!invocations || invocations.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="empty">no invocations yet</td></tr>';
      return;
    }
    invocations.forEach(function (inv) {
      var tr = document.createElement('tr');
      var timeText = inv.timestamp ? new Date(inv.timestamp).toLocaleTimeString() : '-';
      var skillCell = inv.skill ? '<span class="badge skill-badge">' + escapeHtml(inv.skill) + '</span>' : '-';
      tr.innerHTML =
        '<td>' + escapeHtml(timeText) + '</td>' +
        '<td>' + escapeHtml(inv.tool) + '</td>' +
        '<td>' + skillCell + '</td>' +
        '<td class="wrap">' + escapeHtml(inv.detail || '-') + '</td>';
      body.appendChild(tr);
    });
  }

  function pollInvocations() {
    fetch('/api/invocations')
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(renderInvocations)
      .catch(function () { /* keep last rendered table on fetch failure */ });
  }

  // ---------------------------------------------------------------------
  // Commits correlated to sessions (BL-0014). Same same-origin polling
  // pattern as invocations; the server re-reads git log per request.
  // ---------------------------------------------------------------------
  function confidenceBadgeClass(confidence) {
    if (confidence === 'trailer') return 'confidence-badge confidence-trailer';
    if (confidence === 'time-window') return 'confidence-badge confidence-time-window';
    return 'confidence-badge confidence-none';
  }

  function renderCommits(rows) {
    var body = document.querySelector('#commits-table tbody');
    if (!body) return;
    body.innerHTML = '';
    if (!rows || rows.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="empty">no commits</td></tr>';
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(row.shortHash) + '</td>' +
        '<td class="wrap">' + escapeHtml(row.subject) + '</td>' +
        '<td>' + escapeHtml(row.sessionLabel || '-') + '</td>' +
        '<td><span class="' + confidenceBadgeClass(row.confidence) + '">' + escapeHtml(row.confidence) + '</span></td>';
      body.appendChild(tr);
    });
  }

  function pollCommits() {
    fetch('/api/commits')
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(renderCommits)
      .catch(function () { /* keep last rendered table on fetch failure */ });
  }

  initDocsToggle();
  pollInvocations();
  pollCommits();
  setInterval(pollInvocations, 4000);
  setInterval(pollCommits, 5000);

  // Usage range selection (BL-0008). The dropdown's own DOM node is never touched
  // by render(), so the selection survives every SSE push; changing it reconnects
  // the stream with a new ?range= query string rather than pushing range over an
  // open connection.
  var es = null;
  function connect(range) {
    if (es) es.close();
    es = new EventSource('/api/events?range=' + encodeURIComponent(range));
    es.onmessage = function (ev) {
      try {
        var snapshot = JSON.parse(ev.data);
        render(snapshot);
      } catch (e) {
        /* ignore parse errors */
      }
    };
  }

  var rangeSelect = document.getElementById('range-select');
  connect(rangeSelect ? rangeSelect.value : 'today');
  if (rangeSelect) {
    rangeSelect.addEventListener('change', function () {
      connect(rangeSelect.value);
    });
  }
})();
`

export const renderPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>platonic dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0b0e14;
    color: #d8dee9;
    padding: 16px;
  }
  h1, h2, h3 { font-weight: 600; margin: 0 0 8px; }
  header {
    display: flex;
    align-items: baseline;
    gap: 24px;
    border-bottom: 1px solid #263043;
    padding-bottom: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  header h1 { font-size: 20px; color: #8ab4f8; }
  .muted { color: #6b7793; font-size: 13px; }
  .big-number { font-size: 28px; font-weight: 700; color: #7ee787; }
  section { margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1c2433; white-space: nowrap; }
  th { color: #6b7793; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  td.wrap { white-space: normal; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
  .dot.active { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
  .dot.inactive { background: #4b5468; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; background: #263043; color: #8ab4f8; margin-left: 6px; }
  .status-group { margin-bottom: 12px; }
  .status-group h3 { font-size: 13px; color: #8ab4f8; text-transform: uppercase; margin: 0 0 6px; }
  .pri { color: #f0883e; }
  #root { max-width: 1200px; margin: 0 auto; }
  .empty { color: #4b5468; font-size: 13px; padding: 8px 0; }
  .grid-usage { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 12px; }
  .stat { min-width: 100px; }
  .stat .label { font-size: 11px; color: #6b7793; text-transform: uppercase; }
  .stat .value { font-size: 18px; color: #d8dee9; }
  .range-select {
    font-family: inherit;
    font-size: 12px;
    margin-left: 12px;
    background: #161b22;
    color: #d8dee9;
    border: 1px solid #263043;
    border-radius: 4px;
    padding: 3px 6px;
  }
  #docs-toggle {
    background: none;
    border: none;
    color: #8ab4f8;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
    margin-bottom: 12px;
  }
  #docs-toggle:hover { text-decoration: underline; }
  #docs-explanation {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease-out;
    background: #161b22;
    border: 1px solid #263043;
    border-radius: 4px;
    padding: 0 12px;
    margin-bottom: 16px;
  }
  #docs-explanation.open {
    max-height: 2000px;
    padding: 12px;
  }
  #docs-explanation h3 { font-size: 12px; color: #8ab4f8; text-transform: uppercase; margin: 12px 0 6px; }
  #docs-explanation h3:first-child { margin-top: 0; }
  #docs-explanation p { margin: 6px 0; font-size: 12px; line-height: 1.5; color: #c9d1d9; }
  #docs-explanation ul { margin: 6px 0; padding-left: 20px; font-size: 12px; color: #c9d1d9; }
  #docs-explanation li { margin: 4px 0; line-height: 1.5; }
  #docs-explanation code { color: #7ee787; background: #0b0e14; padding: 0 3px; border-radius: 3px; }
  .idea-row { cursor: pointer; }
  .idea-row:hover td { background: #161b22; }
  .idea-row td:first-child { color: #6b7793; }
  .idea-row.expanded td { background: #161b22; }
  .idea-detail { display: none; }
  .idea-detail.open { display: table-row; }
  .idea-detail td { background: #161b22; }
  .idea-meta { font-size: 11px; margin-bottom: 6px; }
  .idea-meta a { color: #8ab4f8; text-decoration: none; }
  .idea-text {
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    color: #c9d1d9;
    margin: 0;
  }
  .pie-chart { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
  .pie-legend { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .pie-legend-row { display: flex; align-items: center; gap: 6px; color: #d8dee9; }
  .pie-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .skill-badge { background: #21362b; color: #7ee787; font-weight: 600; }
  .confidence-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
  .confidence-trailer { background: #21362b; color: #7ee787; }
  .confidence-time-window { background: #3a2e12; color: #f0883e; }
  .confidence-none { background: #263043; color: #6b7793; }
</style>
</head>
<body>
<div id="root">
  <header>
    <h1>platonic dashboard</h1>
    <div class="muted">last update: <span id="last-update">-</span></div>
    <div>
      <div class="muted">output tokens/min</div>
      <div class="big-number" id="tpm">-</div>
    </div>
  </header>

  <button id="docs-toggle">+ How the dashboard works</button>
  <div id="docs-explanation">
    <h3>Purpose</h3>
    <p>This page shows what the coding agents working on this repository have done and are doing — which agents ran, on which models, at what token cost — alongside the work and ideas they have logged.</p>
    <h3>Agents</h3>
    <p>One row per session transcript, including subagents (marked <span class="badge">sidechain</span>). Shows the model of the last assistant message, the most recent tool call, a snippet of the latest output, cumulative input/output tokens, and how long ago the transcript last changed. A green dot means the session was active recently, gray means it was not.</p>
    <h3>Usage</h3>
    <p>Token totals across every transcript being watched:</p>
    <ul>
      <li><strong>in</strong> — input tokens (prompt/context)</li>
      <li><strong>out</strong> — output tokens (completions)</li>
      <li><strong>cache read</strong> — tokens read from prompt cache</li>
      <li><strong>cache create</strong> — tokens written to cache</li>
    </ul>
    <p>The table breaks the same totals down by model. The output-tokens-per-minute figure in the header is a rate over the last five minutes, not an all-time average. The dropdown next to the Usage heading scopes both the totals and the per-model table to a time window (last hour / today / all time) or an item-count window (last 100 / last 500 activities) — pick whichever fits better when activity is bursty.</p>
    <h3>Ideas</h3>
    <p>Backlog items with status "idea" — captured but untriaged. Click a row to expand its full elaboration (assumptions, design decisions, approach). Click the file link to open it in VSCode.</p>
    <h3>Backlog</h3>
    <p>Work items grouped by status (in-progress/ready/done/dropped), WorkQuarry schema. Priority p1 (highest) to p3, plus type and effort.</p>
    <h3>Docs</h3>
    <p>The design notes in the repository, listed by title, last modification, and size, newest first. Click a file link to open it in VSCode.</p>
    <h3>Recent tool + skill invocations</h3>
    <p>Every tool call an agent made, most recent first (last 100), with the specific skill named when the tool was <code>Skill</code>. Polled separately from the main snapshot stream every few seconds.</p>
    <h3>Commits</h3>
    <p>Recent git commits (last 30), each with a best-effort link to the session that produced it: an exact match from a <code>Session-Id</code>/<code>Co-Authored-By</code> trailer, a same-origin time-window guess, or no match. Polled every few seconds; the server re-reads git log on each request.</p>
    <h3>Where the data comes from</h3>
    <ul>
      <li><strong>Agents, Usage</strong> — the JSONL session transcripts Claude Code writes for every session, under <code>~/.claude/projects/</code>, plus the per-session subagent and task transcript directories. Nothing is instrumented in the agents themselves; the dashboard only reads files that already exist.</li>
      <li><strong>Ideas, Backlog</strong> — the markdown files in <code>backlog/</code>.</li>
      <li><strong>Docs</strong> — the markdown files in <code>docs/</code>.</li>
    </ul>
    <h3>How it refreshes</h3>
    <p>The page holds one server-sent-events connection to <code>/api/events</code>. Every two seconds the server re-reads whatever has been appended to the transcripts, reloads the backlog and docs, and pushes a complete snapshot, which replaces what is on screen. Nothing is stored between ticks. The same snapshot is available as JSON at <code>/api/state</code>.</p>
    <h3>What this dashboard is not</h3>
    <p>It is not a code browser. It does not navigate TypeScript source, look up symbols, compute code metrics, or score code quality. That job belongs to a separate tool; adding it here would blur what this page is for. Everything shown here is agent activity and logged work.</p>
  </div>

  <section>
    <h2>Agents</h2>
    <table id="agents-table">
      <thead>
        <tr><th></th><th>Label</th><th>Model</th><th>Tool</th><th>Snippet</th><th>In</th><th>Out</th><th>Last activity</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>Usage
      <select id="range-select" class="range-select">
        ${rangeOptionsHtml}
      </select>
    </h2>
    <div class="grid-usage" id="usage-totals"></div>
    <div id="usage-pie"></div>
    <table id="usage-table">
      <thead>
        <tr><th>Model</th><th>In</th><th>Out</th><th>Cache read</th><th>Cache create</th><th>Msgs</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>Ideas</h2>
    <div id="ideas"></div>
  </section>

  <section>
    <h2>Backlog</h2>
    <div id="backlog-pie"></div>
    <div id="backlog"></div>
  </section>

  <section>
    <h2>Recent tool + skill invocations</h2>
    <table id="invocations-table">
      <thead>
        <tr><th>Time</th><th>Tool</th><th>Skill</th><th>Detail</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>Commits</h2>
    <table id="commits-table">
      <thead>
        <tr><th>Hash</th><th>Subject</th><th>Session</th><th>Confidence</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>Docs</h2>
    <table id="docs-table">
      <thead>
        <tr><th>File</th><th>Title</th><th>Modified</th><th>Size</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>
</div>

<script>
${clientScript}
</script>
</body>
</html>
`
