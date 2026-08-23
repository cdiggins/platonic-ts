// The catalogue entries for the tools that only answer questions. A
// description is the whole of what an agent knows when it picks a tool, so each
// one says what the tool replaces, what it costs, and — where it matters most —
// what it cannot see.
import { count, flag, folder, symbolFile, symbolName, text, textList, tool, type ToolSpec } from './schema.ts'

// Tools for exploring the codebase structure and finding declarations.
export const navigationTools: readonly ToolSpec[] = [
  tool(
    'outline',
    'Signatures of every declaration in one or more TypeScript files, with line numbers. Use instead of reading a whole file when you need to know what is in it — costs roughly a tenth of the tokens.',
    {
      files: textList('Repo-relative paths.'),
      all: flag('Include nested declarations — members and locals — not just top-level ones (default false).'),
    },
    ['files'],
  ),
  tool(
    'symbol',
    'The full source of one declaration, with its leading comment and location. Use instead of grep-then-read when you know the name.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'usages',
    'Every place a symbol is used, resolved by the TypeScript type checker rather than by text match, one line of context each. Unlike grep it finds no same-named strangers and misses no aliased imports. Counts import lines as uses; callers does not.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'search',
    'Find declarations whose name contains a string, across the repo. Returns kind, location, and signature.',
    {
      query: text('Substring of the name, case-insensitive.'),
      kind: text('Optional filter: function, variable, type, interface, class, enum, method, property.'),
      all: flag('Include non-exported declarations (default false).'),
    },
    ['query'],
  ),
  tool(
    'repo_map',
    'One line per folder — file count, lines, quality score — then the most-used exported declarations with signatures, ranked by how often the rest of the repository uses them. Use to orient in an unfamiliar repository, and to see what already exists before writing something new.',
    {
      budget: count(
        'Characters allowed for the ranked declarations (default 4000; 0 omits them).',
      ),
    },
    [],
  ),
]

// Tools for inspecting types and error diagnostics.
export const typeTools: readonly ToolSpec[] = [
  tool(
    'type_of',
    'The type the checker infers for a declaration, printed in full rather than truncated, with one line per call signature. Use instead of guessing a parameter or return type from the source. Refuses when the answer would be any, since the checker prints its error type and a real any identically.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'members_of',
    'The whole surface of a type, inherited members included, each attributed to the type it comes from. An outline cannot show inherited members; this is how to see them.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'diagnostics',
    'Type and syntax errors for the named files only, from the already-loaded program. A fast inner-loop check while a multi-step edit is in flight — NOT the gate. Only check decides whether the repository is green.',
    { files: textList('Repo-relative paths.') },
    ['files'],
  ),
  tool(
    'code_fixes',
    'What the compiler offers to do about the errors at a location, by machine-readable name. A plain type error usually offers nothing, which is not a failure. Call before apply_code_fix when you want to choose.',
    {
      file: text('Repo-relative path.'),
      line: count('1-based line. Default is every diagnostic in the file.'),
    },
    ['file'],
  ),
  tool(
    'refactorings',
    'The compiler\'s own refactorings that apply to a declaration, by refactor and action name. The escape hatch for transformations the specific tools do not cover; feed a pair to apply_refactor.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
]

// Tools for analyzing code relationships, quality metrics, and changes.
export const analysisTools: readonly ToolSpec[] = [
  tool(
    'callers',
    'The call graph above a function, as an indented tree to the given depth, recursion marked. Directional where usages is flat. A caller is the nearest enclosing function, method, or class: a reference from a top-level initializer, a type annotation, or an import has none and does not appear.',
    {
      name: symbolName,
      file: symbolFile,
      depth: count('Levels to walk up; 1 is direct callers (default 2).'),
    },
    ['name'],
  ),
  tool(
    'implementations',
    'Classes that implement an interface or extend a class, and methods that override one. Heritage is exact; override detection is one level and by name, so a grandchild overriding through an intermediate is missed.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'tests_for_symbol',
    'Which tests reach a symbol, directly or through one level of non-test helper. "Test" means the file path, not what the file does. No answer is the finding: an unexercised symbol is the thing worth knowing.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'blast_radius',
    'Uses, transitive callers, and covering tests for one symbol in a single call. Ask this before changing something you did not write, instead of asking three tools separately.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'module_graph',
    'Import edges between files, and every cycle. Relative specifiers only — a package import is not an edge. Cycles are found repo-wide even when folder narrows the edge list.',
    { folder },
    [],
  ),
  tool(
    'unused_exports',
    'Exported declarations whose only references are in their own file. Candidates, not verdicts: a symbol consumed outside the indexed set looks identical to a dead one. Use through a barrel counts as use.',
    { folder },
    [],
  ),
  tool(
    'symbol_metrics',
    'Length, statements, nesting, parameters, and quality score for one declaration, beside its file\'s own numbers, so you can see whether it is the outlier or the norm. Ask before deciding what to refactor.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'escape_hatch_index',
    'Every any, as, non-null assertion, and suppression comment, with location and line text, compared against the ratchet baseline. The same classification the gate uses, so the two cannot disagree.',
    { folder },
    [],
  ),
  tool(
    'symbol_diff',
    'What changed in the working tree since HEAD, by declaration rather than by line: added, removed, changed, and moved. A refactoring reads as a large deletion beside a large addition in a line diff; this says "moved" instead. Use to review your own work.',
    {},
    [],
  ),
]
