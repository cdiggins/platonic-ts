// Single-page code browser HTML. All CSS/JS inline, zero external requests.
// The client fetches /api/index, /api/file, /api/references and POSTs /api/feedback.
//
// PS-056 (breaking PS-024, files under 300 lines): a self-contained single-page app is
// one artifact — markup, styling and behaviour of the same page — and splitting it into
// modules would only move template strings around while making the page harder to read
// end to end. packages/dashboard/src/ui.ts carries the same exemption for the same reason.
//
// DOM contract this file relies on, produced by renderSourceHtml in ./render.ts:
//   - each source line is an element carrying class `line` and `data-line="<1-based>"`
//   - a reference token is `<a class="symbol" data-symbol="<SymbolId>" href="#">`
//   - a definition token additionally carries `id="sym-<SymbolId>"`
//   - highlight tokens carry their TokenClass as a class name (`keyword`, `string`, ...)
// Line jumps degrade gracefully: `data-line`, then `#line-<n>`, then the nth `.code-line`.

const scoreRamp = `
  .s-a { color: #3fb950; }
  .s-b { color: #7ee787; }
  .s-c { color: #e3b341; }
  .s-d { color: #f0883e; }
  .s-e { color: #f85149; }
  .s-none { color: #4b5468; }
  .score { font-variant-numeric: tabular-nums; font-size: 11px; }
  .score-badge { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
`

const styles = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0b0e14;
    color: #d8dee9;
    font-size: 13px;
  }
  h1, h2, h3 { font-weight: 600; margin: 0 0 8px; }
  a { color: #8ab4f8; }
  button {
    font-family: inherit;
    font-size: 12px;
    color: #d8dee9;
    background: #1c2433;
    border: 1px solid #263043;
    border-radius: 3px;
    padding: 3px 8px;
    cursor: pointer;
  }
  button:hover { border-color: #8ab4f8; }
  header {
    display: flex;
    align-items: baseline;
    gap: 20px;
    flex-wrap: wrap;
    border-bottom: 1px solid #263043;
    padding: 10px 16px;
  }
  header h1 { font-size: 18px; color: #8ab4f8; margin: 0; }
  .muted { color: #6b7793; font-size: 12px; }
  #explain-toggle {
    background: none;
    border: none;
    color: #8ab4f8;
    font-weight: 600;
    padding: 0;
  }
  #explain {
    display: none;
    overflow: auto;
    max-height: 45vh;
    background: #161b22;
    border-bottom: 1px solid #263043;
    padding: 12px 16px;
  }
  #explain.open { display: block; }
  #explain h3 { font-size: 12px; color: #8ab4f8; text-transform: uppercase; margin: 12px 0 6px; }
  #explain h3:first-child { margin-top: 0; }
  #explain p, #explain li { font-size: 12px; line-height: 1.55; color: #c9d1d9; }
  #explain p { margin: 6px 0; }
  #explain ul { margin: 6px 0; padding-left: 20px; }
  #explain code { color: #7ee787; background: #0b0e14; padding: 0 3px; border-radius: 3px; }
  main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) 340px;
  }
  .pane { overflow: auto; min-width: 0; }
  #tree-pane { border-right: 1px solid #263043; padding: 8px 0; }
  #metrics-pane { border-left: 1px solid #263043; padding: 10px 12px; }
  .pane-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7793;
    padding: 0 12px 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px 2px 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover { background: #161b22; }
  .row.selected { background: #1c2433; }
  .row .caret { width: 10px; color: #6b7793; }
  .row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .row.folder .name { color: #8ab4f8; }
  .children.collapsed { display: none; }
  .empty { color: #4b5468; padding: 8px 12px; }
  .error {
    color: #f85149;
    background: #1c1416;
    border: 1px solid #4a2126;
    border-radius: 3px;
    padding: 8px 10px;
    margin: 10px 12px;
    white-space: pre-wrap;
  }
  #source-pane { padding: 0; }
  #source-head {
    position: sticky;
    top: 0;
    background: #0b0e14;
    border-bottom: 1px solid #263043;
    padding: 8px 14px;
    display: flex;
    gap: 12px;
    align-items: baseline;
    z-index: 2;
  }
  #source-body { padding: 8px 0 40px; }
  .code { font-size: 12.5px; line-height: 1.5; }
  .code .code-line { display: block; padding: 0 12px; }
  .code .code-line:target, .code .flash { background: #2d3a1f; }
  .code .line-number {
    display: inline-block;
    width: 44px;
    text-align: right;
    margin-right: 12px;
    color: #4b5468;
    user-select: none;
  }
  .code .line-code { white-space: pre; }
  .code .token-keyword { color: #ff7b72; }
  .code .token-string { color: #a5d6ff; }
  .code .token-number { color: #79c0ff; }
  .code .token-comment { color: #6b7793; font-style: italic; }
  .code .token-type { color: #ffa657; }
  .code .token-identifier { color: #d8dee9; }
  .code .token-punctuation { color: #8b949e; }
  .code .token-plain { color: #d8dee9; }
  .code a.symbol { color: inherit; text-decoration: none; border-bottom: 1px dotted #4b5468; }
  .code a.symbol:hover { color: #8ab4f8; border-bottom-color: #8ab4f8; }
  .flash { animation: flash 1.2s ease-out; }
  @keyframes flash { from { background: #3d4d24; } to { background: transparent; } }
  .markdown { padding: 8px 24px 40px; max-width: 900px; line-height: 1.6; font-family: system-ui, sans-serif; }
  .markdown h1 { font-size: 24px; border-bottom: 1px solid #263043; padding-bottom: 6px; }
  .markdown h2 { font-size: 19px; margin-top: 24px; }
  .markdown h3 { font-size: 15px; margin-top: 18px; }
  .markdown p { margin: 10px 0; color: #c9d1d9; }
  .markdown ul, .markdown ol { padding-left: 24px; color: #c9d1d9; }
  .markdown li { margin: 4px 0; }
  .markdown code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12.5px;
    background: #161b22;
    padding: 1px 4px;
    border-radius: 3px;
    color: #7ee787;
  }
  .markdown pre {
    background: #161b22;
    border: 1px solid #263043;
    border-radius: 4px;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .markdown pre code { background: none; padding: 0; color: #c9d1d9; }
  .markdown blockquote {
    border-left: 3px solid #263043;
    margin: 10px 0;
    padding: 2px 12px;
    color: #8b949e;
  }
  .markdown table { border-collapse: collapse; margin: 12px 0; }
  .markdown th, .markdown td { border: 1px solid #263043; padding: 5px 10px; text-align: left; }
  .markdown th { background: #161b22; color: #8ab4f8; }
  table.data { border-collapse: collapse; width: 100%; font-size: 12px; }
  table.data th, table.data td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid #1c2433;
    white-space: nowrap;
  }
  table.data th {
    color: #6b7793;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  table.data th.sorted { color: #8ab4f8; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data tr.clickable { cursor: pointer; }
  table.data tr.clickable:hover td { background: #161b22; }
  .metric-block { margin-bottom: 18px; }
  .metric-block h3 { font-size: 11px; text-transform: uppercase; color: #6b7793; letter-spacing: 0.04em; }
  .headline { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .headline .path { font-size: 12px; color: #c9d1d9; overflow-wrap: anywhere; }
  .ref-list { list-style: none; margin: 0; padding: 0; }
  .ref-list li { padding: 2px 0; }
  .ref-list button {
    background: none;
    border: none;
    color: #8ab4f8;
    padding: 0;
    text-align: left;
    font-size: 12px;
  }
  .signature {
    color: #8b949e;
    font-size: 11.5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 4px 0 8px;
  }
  footer {
    border-top: 1px solid #263043;
    background: #0f131b;
    padding: 8px 16px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  footer textarea {
    flex: 1;
    min-height: 46px;
    max-height: 120px;
    resize: vertical;
    font-family: inherit;
    font-size: 12px;
    color: #d8dee9;
    background: #0b0e14;
    border: 1px solid #263043;
    border-radius: 3px;
    padding: 6px 8px;
  }
  footer .feedback-side { width: 320px; }
  .hint { color: #6b7793; font-size: 11px; line-height: 1.45; margin-bottom: 6px; }
  #feedback-status { font-size: 11px; margin-left: 8px; }
  #feedback-status.ok { color: #7ee787; }
  #feedback-status.bad { color: #f85149; }
${scoreRamp}
`

const clientScript = `
(function () {
  var METRIC_FIELDS = [
    ['lines', 'lines'],
    ['statements', 'statements'],
    ['maxNestingDepth', 'max nesting depth'],
    ['parameters', 'parameters'],
    ['mutableBindings', 'mutable bindings'],
    ['classes', 'classes'],
    ['throwStatements', 'throw statements'],
    ['explicitAny', 'explicit any'],
    ['asCasts', 'as casts'],
    ['nonNullAssertions', 'non-null assertions'],
    ['tsDirectives', 'ts directives'],
    ['eslintDisables', 'eslint disables'],
    ['exportedSymbols', 'exported symbols'],
    ['imports', 'imports']
  ];

  var state = {
    index: null,
    folders: {},
    collapsed: {},
    file: null,
    view: null,
    symbol: null,
    references: null,
    functionSort: 'score'
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function element(id) { return document.getElementById(id); }

  function scoreClass(score) {
    if (typeof score !== 'number' || isNaN(score)) return 's-none';
    if (score >= 90) return 's-a';
    if (score >= 75) return 's-b';
    if (score >= 60) return 's-c';
    if (score >= 40) return 's-d';
    return 's-e';
  }

  function scoreText(score) {
    return typeof score === 'number' && !isNaN(score) ? String(Math.round(score)) : '-';
  }

  function scoreSpan(score, className) {
    return '<span class="' + className + ' ' + scoreClass(score) + '">' + scoreText(score) + '</span>';
  }

  function fileOf(symbolId) {
    var cut = String(symbolId).lastIndexOf('#');
    return cut < 0 ? String(symbolId) : String(symbolId).slice(0, cut);
  }

  // The server reports failures as { error } JSON bodies, so read the body either way
  // and prefer its message over the bare status line.
  function getJson(url) {
    return fetch(url)
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var detail = data && data.error ? data.error : response.status + ' ' + response.statusText;
            return { ok: false, error: detail + ' (' + url + ')' };
          }
          return { ok: true, data: data };
        });
      })
      .catch(function (error) { return { ok: false, error: String(error && error.message ? error.message : error) }; });
  }

  // ---- tree -------------------------------------------------------------

  function buildTree(files) {
    var root = { name: '', path: '', folders: {}, order: [], files: [] };
    files.forEach(function (entry) {
      var parts = String(entry.file).split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var segment = parts[i];
        if (!node.folders[segment]) {
          var path = node.path === '' ? segment : node.path + '/' + segment;
          node.folders[segment] = { name: segment, path: path, folders: {}, order: [], files: [] };
          node.order.push(segment);
        }
        node = node.folders[segment];
      }
      node.files.push(entry);
    });
    return root;
  }

  function baseName(path) {
    var parts = String(path).split('/');
    return parts[parts.length - 1];
  }

  function renderNode(node, depth) {
    var pad = 'style="padding-left:' + (depth * 12 + 6) + 'px"';
    var html = '';
    node.order.slice().sort().forEach(function (key) {
      var child = node.folders[key];
      var folder = state.folders[child.path];
      var collapsed = state.collapsed[child.path] === true;
      html +=
        '<div class="row folder" data-folder="' + escapeHtml(child.path) + '" ' + pad + '>' +
        '<span class="caret">' + (collapsed ? '+' : '-') + '</span>' +
        '<span class="name">' + escapeHtml(child.name) + '</span>' +
        scoreSpan(folder ? folder.metrics.platonicScore : undefined, 'score') +
        '</div>' +
        '<div class="children' + (collapsed ? ' collapsed' : '') + '">' +
        renderNode(child, depth + 1) +
        '</div>';
    });
    node.files.slice().sort(function (a, b) { return a.file < b.file ? -1 : 1; }).forEach(function (entry) {
      var selected = state.file === entry.file ? ' selected' : '';
      html +=
        '<div class="row file' + selected + '" data-path="' + escapeHtml(entry.file) + '" ' + pad + '>' +
        '<span class="caret"></span>' +
        '<span class="name">' + escapeHtml(baseName(entry.file)) + '</span>' +
        scoreSpan(entry.metrics ? entry.metrics.platonicScore : undefined, 'score') +
        '</div>';
    });
    return html;
  }

  function renderTree() {
    var host = element('tree');
    if (!state.index) return;
    if (!state.index.files || state.index.files.length === 0) {
      host.innerHTML = '<div class="empty">index is empty - nothing to browse</div>';
      return;
    }
    host.innerHTML = renderNode(buildTree(state.index.files), 0);
  }

  // ---- metrics ----------------------------------------------------------

  function metricsTable(metrics) {
    if (!metrics) return '<div class="empty">no metrics for this file</div>';
    var rows = METRIC_FIELDS.map(function (field) {
      var value = metrics[field[0]];
      return '<tr><td>' + escapeHtml(field[1]) + '</td><td class="num">' +
        escapeHtml(typeof value === 'number' ? value : '-') + '</td></tr>';
    }).join('');
    return '<table class="data"><tbody>' + rows + '</tbody></table>';
  }

  function sortedFunctions(functions) {
    var copy = functions.slice();
    copy.sort(function (a, b) {
      if (state.functionSort === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      if (state.functionSort === 'line') return a.line - b.line;
      return a.metrics.platonicScore - b.metrics.platonicScore;
    });
    return copy;
  }

  function functionsTable(functions) {
    if (!functions || functions.length === 0) return '<div class="empty">no functions</div>';
    var head =
      '<tr>' +
      '<th data-sort="name" class="' + (state.functionSort === 'name' ? 'sorted' : '') + '">function</th>' +
      '<th data-sort="line" class="' + (state.functionSort === 'line' ? 'sorted' : '') + '">line</th>' +
      '<th data-sort="score" class="' + (state.functionSort === 'score' ? 'sorted' : '') + '">score</th>' +
      '</tr>';
    var rows = sortedFunctions(functions).map(function (fn) {
      return '<tr class="clickable" data-line="' + escapeHtml(fn.line) + '">' +
        '<td>' + escapeHtml(fn.name) + '</td>' +
        '<td class="num">' + escapeHtml(fn.line) + '</td>' +
        '<td class="num">' + scoreSpan(fn.metrics.platonicScore, 'score') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="data" id="functions-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  function renderMetricsForFile() {
    var view = state.view;
    var host = element('metrics');
    var score = view.metrics ? view.metrics.platonicScore : undefined;
    host.innerHTML =
      '<div class="headline">' + scoreSpan(score, 'score-badge') +
      '<span class="path">' + escapeHtml(view.file) + '</span></div>' +
      '<div class="metric-block"><h3>file metrics</h3>' + metricsTable(view.metrics) + '</div>' +
      '<div class="metric-block"><h3>functions (worst first)</h3>' + functionsTable(view.functions) + '</div>' +
      '<div class="metric-block" id="symbol-block"></div>';
    renderSymbolBlock();
  }

  function renderMetricsForFolder(path) {
    var folder = state.folders[path];
    var host = element('metrics');
    if (!folder) {
      host.innerHTML = '<div class="empty">no metrics for ' + escapeHtml(path) + '</div>';
      return;
    }
    host.innerHTML =
      '<div class="headline">' + scoreSpan(folder.metrics.platonicScore, 'score-badge') +
      '<span class="path">' + escapeHtml(folder.path) + '</span></div>' +
      '<div class="muted">' + escapeHtml(folder.fileCount) + ' files</div>' +
      '<div class="metric-block"><h3>folder metrics (sum of files)</h3>' + metricsTable(folder.metrics) + '</div>';
  }

  // ---- symbols ----------------------------------------------------------

  function symbolInfo(symbolId) {
    if (!state.view || !state.view.symbols) return null;
    var found = state.view.symbols.filter(function (s) { return s.id === symbolId; });
    return found.length > 0 ? found[0] : null;
  }

  function renderSymbolBlock() {
    var host = element('symbol-block');
    if (!host) return;
    if (!state.symbol) {
      host.innerHTML = '<h3>symbol</h3><div class="empty">click a symbol in the source</div>';
      return;
    }
    var info = symbolInfo(state.symbol);
    var name = info ? info.name : baseName(state.symbol);
    var refs = state.references;
    var list = '';
    if (refs && refs.symbol === state.symbol) {
      list = refs.error
        ? '<div class="error">' + escapeHtml(refs.error) + '</div>'
        : refs.items.length === 0
          ? '<div class="empty">no references found</div>'
          : '<ul class="ref-list">' + refs.items.map(function (r) {
              return '<li><button class="ref" data-file="' + escapeHtml(r.file) + '" data-line="' +
                escapeHtml(r.line) + '">' + escapeHtml(r.file) + ':' + escapeHtml(r.line) +
                (r.isDefinition ? ' (definition)' : '') + '</button></li>';
            }).join('') + '</ul>';
    }
    host.innerHTML =
      '<h3>symbol</h3>' +
      '<div><strong>' + escapeHtml(name) + '</strong>' +
      (info && info.kind ? ' <span class="muted">' + escapeHtml(info.kind) + '</span>' : '') + '</div>' +
      (info && info.signature ? '<div class="signature">' + escapeHtml(info.signature) + '</div>' : '') +
      '<div class="muted">' + escapeHtml(state.symbol) + '</div>' +
      '<div style="margin:8px 0"><button id="refs-button">references</button> ' +
      '<button id="def-button">definition</button></div>' + list;
  }

  function flash(node) {
    if (!node) return;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
    node.scrollIntoView({ block: 'center' });
  }

  function scrollToSymbol(symbolId) {
    flash(document.getElementById('sym-' + symbolId));
  }

  function scrollToLine(line) {
    var body = element('source-body');
    var node = body.querySelector('[data-line="' + line + '"]') || document.getElementById('line-' + line);
    if (!node) {
      var lines = body.querySelectorAll('.code-line');
      node = lines.length >= line ? lines[line - 1] : null;
    }
    flash(node);
  }

  function gotoDefinition(symbolId) {
    var target = fileOf(symbolId);
    if (target === state.file) {
      scrollToSymbol(symbolId);
      return Promise.resolve();
    }
    return selectFile(target).then(function () { scrollToSymbol(symbolId); });
  }

  function showReferences(symbolId) {
    state.symbol = symbolId;
    renderSymbolBlock();
    return getJson('/api/references?symbol=' + encodeURIComponent(symbolId)).then(function (result) {
      state.references = result.ok
        ? { symbol: symbolId, items: result.data || [], error: null }
        : { symbol: symbolId, items: [], error: 'references failed: ' + result.error };
      renderSymbolBlock();
    });
  }

  // ---- file view --------------------------------------------------------

  function renderFile() {
    var view = state.view;
    element('source-title').textContent = view.file;
    element('source-kind').textContent = view.kind;
    var body = element('source-body');
    // view.html is produced by the server's renderer and already escaped there.
    body.className = view.kind === 'markdown' ? 'markdown' : 'code';
    body.innerHTML = view.html && view.html.length > 0
      ? view.html
      : '<div class="empty">this file rendered as empty</div>';
    renderMetricsForFile();
  }

  function selectFile(path) {
    return getJson('/api/file?path=' + encodeURIComponent(path)).then(function (result) {
      if (!result.ok || !result.data) {
        element('source-title').textContent = path;
        element('source-kind').textContent = '';
        element('source-body').className = '';
        element('source-body').innerHTML = '<div class="error">could not load ' + escapeHtml(path) + '\\n' +
          escapeHtml(result.ok ? 'empty response' : result.error) + '</div>';
        return;
      }
      state.file = path;
      state.view = result.data;
      state.symbol = null;
      state.references = null;
      renderFile();
      renderTree();
    });
  }

  // ---- events -----------------------------------------------------------

  element('tree').addEventListener('click', function (event) {
    var row = event.target.closest('.row');
    if (!row) return;
    var folder = row.getAttribute('data-folder');
    if (folder !== null) {
      state.collapsed[folder] = !(state.collapsed[folder] === true);
      renderTree();
      renderMetricsForFolder(folder);
      return;
    }
    var path = row.getAttribute('data-path');
    if (path !== null) void selectFile(path);
  });

  element('source-body').addEventListener('click', function (event) {
    var anchor = event.target.closest('a.symbol');
    if (!anchor) return;
    event.preventDefault();
    var symbolId = anchor.getAttribute('data-symbol');
    if (!symbolId) return;
    state.symbol = symbolId;
    state.references = null;
    renderSymbolBlock();
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      void showReferences(symbolId);
      return;
    }
    void gotoDefinition(symbolId);
  });

  element('metrics').addEventListener('click', function (event) {
    var target = event.target;
    if (target.id === 'refs-button' && state.symbol) { void showReferences(state.symbol); return; }
    if (target.id === 'def-button' && state.symbol) { void gotoDefinition(state.symbol); return; }
    var ref = target.closest ? target.closest('button.ref') : null;
    if (ref) {
      var file = ref.getAttribute('data-file');
      var line = Number(ref.getAttribute('data-line'));
      if (file === state.file) scrollToLine(line);
      else void selectFile(file).then(function () { scrollToLine(line); });
      return;
    }
    var header = target.closest ? target.closest('th[data-sort]') : null;
    if (header && state.view) {
      state.functionSort = header.getAttribute('data-sort');
      renderMetricsForFile();
      return;
    }
    var row = target.closest ? target.closest('tr.clickable') : null;
    if (row) scrollToLine(Number(row.getAttribute('data-line')));
  });

  element('explain-toggle').addEventListener('click', function () {
    var panel = element('explain');
    var open = panel.classList.toggle('open');
    element('explain-toggle').textContent = (open ? '- ' : '+ ') + 'How this browser works';
  });

  element('feedback-send').addEventListener('click', function () {
    var textarea = element('feedback-text');
    var status = element('feedback-status');
    var text = textarea.value.trim();
    if (text.length === 0) {
      status.className = 'bad';
      status.textContent = 'nothing to send';
      return;
    }
    status.className = '';
    status.textContent = 'sending...';
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, file: state.file, symbol: state.symbol })
    })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || !data.id) {
            status.className = 'bad';
            status.textContent = 'failed: ' + (data && data.error ? data.error : response.status + ' ' + response.statusText);
            return;
          }
          status.className = 'ok';
          status.textContent = 'filed ' + data.id;
          textarea.value = '';
        });
      })
      .catch(function (error) {
        status.className = 'bad';
        status.textContent = 'failed: ' + String(error && error.message ? error.message : error);
      });
  });

  // ---- boot -------------------------------------------------------------

  void getJson('/api/index').then(function (result) {
    if (!result.ok || !result.data) {
      element('tree').innerHTML = '<div class="error">could not load the index\\n' +
        escapeHtml(result.ok ? 'empty response' : result.error) + '</div>';
      return;
    }
    state.index = result.data;
    (state.index.folders || []).forEach(function (folder) { state.folders[folder.path] = folder; });
    element('generated').textContent = state.index.generatedAt
      ? new Date(state.index.generatedAt).toLocaleTimeString()
      : '-';
    element('root-path').textContent = state.index.root || '-';
    element('file-count').textContent = (state.index.files || []).length + ' files';
    renderTree();
  });
})();
`

const explainHtml = `
    <h3>What this page is for</h3>
    <p>Reading this repository's own source. It shows the folder and file structure, syntax-coloured
    TypeScript with click-to-navigate symbols, markdown rendered as prose, and the platonic-quality
    metrics computed for every function, file, and folder.</p>

    <h3>The three panes</h3>
    <ul>
      <li><strong>Left</strong> — the tree of every indexed file, grouped by folder. Each row carries
      its platonic score; click a folder name to collapse it and to show that folder's rolled-up
      metrics on the right.</li>
      <li><strong>Middle</strong> — the selected file. TypeScript is rendered as numbered, coloured
      lines in which every resolved identifier is a link. Click one to jump to its definition;
      ctrl-click (or the <em>references</em> button) to list its use sites instead. Markdown files
      are rendered as prose rather than as source.</li>
      <li><strong>Right</strong> — metrics for whatever is selected: every raw count, not only the
      score, plus a per-function table you can sort. It defaults to worst score first.</li>
    </ul>

    <h3>Where the data comes from</h3>
    <p>A <code>CodeIndex</code> built by <code>packages/codemap</code> from the TypeScript compiler
    API — a real program, not a regex — covering <code>packages/*/src</code> and
    <code>packages/*/test</code> plus the markdown in the repository root, <code>docs/</code>,
    <code>decisions/</code>, and <code>backlog/</code>. The server exposes it at
    <code>/api/index</code>, one file at a time at <code>/api/file</code>, and a symbol's use sites
    at <code>/api/references</code>. The index is rebuilt on demand with a short cache, so a reload
    after an edit shows the edit.</p>

    <h3>The platonic score</h3>
    <p>One number from 0 to 100 per function, file, and folder, computed in
    <code>packages/codemap</code> from the raw counts shown beside it: size, statement count,
    nesting depth, parameter count, mutable bindings, classes, throws, and the escape hatches
    (<code>any</code>, <code>as</code>, <code>!</code>, <code>ts-</code> directives, eslint
    disables) counted by the same code <code>platonic check</code> uses, so the two can never
    disagree. A folder's metrics are the sum of its files' and its score is recomputed from that
    sum rather than averaged.</p>
    <p>It is a heuristic, not a verdict. It measures distance from a particular functional style
    and knows nothing about whether the code is correct, necessary, or well named. A low score is
    a place to look, not a defect.</p>

    <h3>Feedback</h3>
    <p>The box along the bottom writes a new item into <code>backlog/</code> — a markdown file with
    status <code>idea</code>, holding your text plus the file and symbol selected when you sent it.
    Nothing else happens automatically: the item sits in the backlog until an agent or a human
    triages it, the same intake path the <code>track-idea</code> skill uses. The reply shows the
    id that was allocated.</p>

    <h3>What this is not</h3>
    <p>This is not the observability dashboard. Agent activity, token usage, and session
    transcripts live in that separate app on port 4747; this page covers source code only and
    reads nothing about agents. The two are deliberately separate tools.</p>
`

export const renderPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>platonic codeview</title>
<style>
${styles}
</style>
</head>
<body>
<header>
  <h1>platonic codeview</h1>
  <div class="muted">root: <span id="root-path">-</span></div>
  <div class="muted"><span id="file-count">-</span></div>
  <div class="muted">indexed: <span id="generated">-</span></div>
  <button id="explain-toggle">+ How this browser works</button>
</header>

<div id="explain">
${explainHtml}
</div>

<main>
  <div class="pane" id="tree-pane">
    <div class="pane-title">files</div>
    <div id="tree"><div class="empty">loading index...</div></div>
  </div>

  <div class="pane" id="source-pane">
    <div id="source-head">
      <strong id="source-title">no file selected</strong>
      <span class="muted" id="source-kind"></span>
    </div>
    <div id="source-body"><div class="empty">pick a file on the left</div></div>
  </div>

  <div class="pane" id="metrics-pane">
    <div class="pane-title">metrics</div>
    <div id="metrics"><div class="empty">select a file or folder</div></div>
  </div>
</main>

<footer>
  <textarea id="feedback-text" placeholder="tell Claude what is wrong with this code, or what to do about it"></textarea>
  <div class="feedback-side">
    <div class="hint">This note becomes an item in <code>backlog/</code> that Claude reads. The
    selected file and symbol are attached as context.</div>
    <button id="feedback-send">send feedback</button>
    <span id="feedback-status"></span>
  </div>
</footer>

<script>
${clientScript}
</script>
</body>
</html>
`
