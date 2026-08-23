// The catalogue entries for the tools that change files. Every one of them
// takes `preview`, and every one of them refuses rather than guessing — the
// descriptions say which cases it refuses on, because a caller who knows that
// asks differently.
import { count, preview, symbolFile, symbolName, text, textList, tool, type ToolSpec } from './schema.ts'

// Tools for modifying individual declarations and organizing imports.
export const editingTools: readonly ToolSpec[] = [
  tool(
    'replace_symbol',
    'Replace one declaration with new source, addressed by name. Unlike a text edit it needs no surrounding context to match, cannot hit the wrong occurrence, and rejects source that does not parse.',
    {
      name: symbolName,
      file: symbolFile,
      source: text('The complete new declaration, including any leading comment and the export keyword.'),
      preview,
    },
    ['name', 'source'],
  ),
  tool(
    'insert_symbol',
    'Add a declaration to a file, after a named declaration or at the end. Rejects source that does not parse.',
    {
      file: text('Repo-relative path.'),
      source: text('The complete new declaration.'),
      after: text('Optional: name of the declaration to insert after. Default is end of file.'),
      preview,
    },
    ['file', 'source'],
  ),
  tool(
    'rename_symbol',
    'Rename a declaration and every use of it across the repository, resolved by the type checker. Refuses rather than guesses when an occurrence is one it cannot rewrite safely.',
    { name: symbolName, file: symbolFile, newName: text('The new identifier.'), preview },
    ['name', 'newName'],
  ),
  tool(
    'delete_symbol',
    'Remove a declaration and the blank line it would leave behind. Refuses while the symbol still has uses, listing them, and refuses when a barrel re-exports it. Remove the uses first.',
    { name: symbolName, file: symbolFile, preview },
    ['name'],
  ),
  tool(
    'organize_imports',
    'Remove unused imports, add missing ones, and sort what remains, in the named files. Replaces the whole import block of a file it changes, so it will collide with any other edit in that region — run it alone.',
    { files: textList('Repo-relative paths.'), preview },
    ['files'],
  ),
  tool(
    'apply_code_fix',
    'Apply one of the compiler\'s own quick fixes. With no fixName, applies the fix only when exactly one is available and otherwise lists them: the wrong quick fix compiles and is still wrong. Note the compiler can generate code this repository bans — fixMissingFunctionDeclaration writes a throw.',
    {
      file: text('Repo-relative path.'),
      line: count('1-based line. Default is every diagnostic in the file.'),
      fixName: text('Machine-readable fix name from code_fixes. Not unique — two importable modules give two fixes both named import.'),
      preview,
    },
    ['file'],
  ),
]

// Tools for refactoring and restructuring code at scale.
export const transformTools: readonly ToolSpec[] = [
  tool(
    'move_symbol',
    'Move a declaration to another file, rewriting every importer, the source file\'s own use of it, and the imports the declaration needs in its new home. Refuses on a hidden dependency, an aliased import, a re-export, a name collision, or a move that would create a cycle. Does not create files. Leaves the source file\'s now-unused import for organize_imports.',
    {
      name: symbolName,
      file: symbolFile,
      toFile: text('Repo-relative path of the destination, which must already exist.'),
      preview,
    },
    ['name', 'toFile'],
  ),
  tool(
    'rename_file',
    'Move a module and rewrite every import specifier that pointed at it. Applies the specifier edits and then moves the file, in that order.',
    {
      file: text('Repo-relative path of the module to move.'),
      newPath: text('Repo-relative destination path, which must be free.'),
      preview,
    },
    ['file', 'newPath'],
  ),
  tool(
    'change_signature',
    'Add, remove, or reorder a function\'s parameters and rewrite every call site. You state the mapping rather than the tool inferring it: an argument of the form $0, $1 copies the existing argument at that index, anything else is inserted as source. Adding a parameter is arguments ["$0", "1"]; removing the second is ["$0"]; swapping is ["$1", "$0"]. Refuses, changing nothing, when any site is not a call — the function passed as a value, used in a type, re-exported, spread, or nested inside another call site.',
    {
      name: symbolName,
      file: symbolFile,
      parameters: textList('The new parameter list, one entry per parameter, as source text.'),
      arguments: textList('The new argument list for every call site. $n copies the old argument at index n.'),
      preview,
    },
    ['name', 'parameters', 'arguments'],
  ),
  tool(
    'apply_refactor',
    'Run one of the compiler\'s own refactorings on a declaration, by the refactor and action names refactorings reports. Note Convert named export to default export produces a default export, which this repository\'s style guide forbids.',
    {
      name: symbolName,
      file: symbolFile,
      refactor: text('Refactor name from refactorings.'),
      action: text('Action name from refactorings.'),
      preview,
    },
    ['name', 'refactor', 'action'],
  ),
]

// Tools for safe batching and reverting of edits.
export const safetyTools: readonly ToolSpec[] = [
  tool(
    'checkpoint',
    'Record the current contents of every indexed file under a label, so revert can restore them. Take one before a multi-step refactoring. Calling it with a label that already exists reports what has changed since instead of overwriting it.',
    { label: text('Name for this point. Default is a timestamp.') },
    [],
  ),
  tool(
    'revert',
    'Restore every file to what it held at a checkpoint. Refuses the whole restore, naming the files, when one was created or deleted since — an edit plan cannot create or remove a file, and a half-undo is worse than none.',
    { label: text('Checkpoint to restore. Default is the most recent one.'), preview },
    [],
  ),
  tool(
    'batch_edit',
    'Apply several edits as one all-or-nothing change. Most real refactorings are only correct together; applied one call at a time the repository is broken in between, and a failure halfway leaves it broken. Every step is planned first, and nothing is written unless every plan succeeds and no two edits overlap.',
    {
      steps: {
        type: 'array',
        description: 'Each step is { "tool": "<any write tool name>", "arguments": { … } }.',
        items: { type: 'object' },
      },
      preview,
    },
    ['steps'],
  ),
]
