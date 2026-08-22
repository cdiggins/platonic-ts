// Single-page dashboard HTML. All CSS/JS inline, zero external requests.
// Client connects to /api/events (SSE) and renders on every push.

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

  var STATUS_ORDER = ['in-progress', 'ready', 'idea', 'done', 'dropped'];

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

  initDocsToggle();

  var es = new EventSource('/api/events');
  es.onmessage = function (ev) {
    try {
      var snapshot = JSON.parse(ev.data);
      render(snapshot);
    } catch (e) {
      /* ignore parse errors */
    }
  };
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
    max-height: 500px;
    padding: 12px;
  }
  #docs-explanation h3 { font-size: 12px; color: #8ab4f8; text-transform: uppercase; margin: 12px 0 6px; }
  #docs-explanation h3:first-child { margin-top: 0; }
  #docs-explanation p { margin: 6px 0; font-size: 12px; line-height: 1.5; color: #c9d1d9; }
  #docs-explanation ul { margin: 6px 0; padding-left: 20px; font-size: 12px; color: #c9d1d9; }
  #docs-explanation li { margin: 4px 0; line-height: 1.5; }
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
    <h3>Agents</h3>
    <p>Real-time activity of running agents. Shows model, most recent tool, output snippet, and token usage. Green dot = active, gray = inactive.</p>
    <h3>Usage</h3>
    <p>Cumulative token metrics across all models and messages:</p>
    <ul>
      <li><strong>in</strong> — input tokens (prompt/context)</li>
      <li><strong>out</strong> — output tokens (completions)</li>
      <li><strong>cache read</strong> — tokens read from prompt cache</li>
      <li><strong>cache create</strong> — tokens written to cache</li>
    </ul>
    <p>Table breaks down usage by model for cost tracking.</p>
    <h3>Backlog</h3>
    <p>Work items grouped by status (in-progress/ready/idea/done/dropped), WorkQuarry schema. Priority p1 (highest) – p3, plus type and effort. Click file links to open in VSCode.</p>
    <h3>Docs</h3>
    <p>Project documentation indexed by title and modification time. Monitor docs you care about without leaving the dashboard.</p>
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
    <h2>Usage</h2>
    <div class="grid-usage" id="usage-totals"></div>
    <table id="usage-table">
      <thead>
        <tr><th>Model</th><th>In</th><th>Out</th><th>Cache read</th><th>Cache create</th><th>Msgs</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>Backlog</h2>
    <div id="backlog"></div>
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
