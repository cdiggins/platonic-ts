// Where one declaration begins and ends in its file, including the comment
// written above it. This is the unit the editing tools address: naming a
// declaration is unambiguous where a text match is not.
import ts from 'typescript'
import type { SymbolInfo } from '../../core/src/index.ts'
import { ancestorsAtPosition } from './workspace.ts'

export type SourceRange = {
  readonly start: number
  readonly end: number
}

const isDeclarationNode = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isVariableStatement(node) ||
  ts.isVariableDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isClassDeclaration(node) ||
  ts.isEnumDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isMethodSignature(node) ||
  ts.isPropertyDeclaration(node) ||
  ts.isPropertySignature(node) ||
  ts.isPropertyAssignment(node) ||
  ts.isModuleDeclaration(node)

// `export const x = …` puts the export keyword on the statement two levels
// above the declaration that carries the name, so a single-declaration
// statement is the real unit. A multi-declarator statement is not: rewriting it
// whole would take its siblings with it.
const widenToStatement = (chain: readonly ts.Node[], node: ts.Node): ts.Node => {
  if (!ts.isVariableDeclaration(node)) return node
  const statement = chain.find(
    (ancestor) =>
      ts.isVariableStatement(ancestor) && ancestor.declarationList.declarations.length === 1,
  )
  return statement ?? node
}

const declarationNodeAt = (sourceFile: ts.SourceFile, position: number): ts.Node | undefined => {
  const chain = ancestorsAtPosition(sourceFile, sourceFile, position)
  const declarations = chain.filter(isDeclarationNode)
  const innermost = declarations[declarations.length - 1]
  return innermost === undefined ? undefined : widenToStatement(chain, innermost)
}

type CommentScan = {
  readonly start: number
  readonly stopped: boolean
}

// Comments directly above the declaration belong to it; a blank line ends the
// block. Without that rule the first declaration in a file would swallow the
// file header.
const startOfLeadingComments = (sourceFile: ts.SourceFile, node: ts.Node): number => {
  const nodeStart = node.getStart(sourceFile)
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? []
  return ranges.reduceRight<CommentScan>(
    (scan, range) =>
      scan.stopped || /\n[ \t]*\r?\n/.test(sourceFile.text.slice(range.end, scan.start))
        ? { start: scan.start, stopped: true }
        : { start: range.pos, stopped: false },
    { start: nodeStart, stopped: false },
  ).start
}

export const declarationRange = (
  sourceFile: ts.SourceFile,
  symbol: SymbolInfo,
): SourceRange | undefined => {
  const node = declarationNodeAt(sourceFile, symbol.span.start)
  return node === undefined
    ? undefined
    : { start: startOfLeadingComments(sourceFile, node), end: node.end }
}

export const declarationText = (
  sourceFile: ts.SourceFile,
  symbol: SymbolInfo,
): string | undefined => {
  const range = declarationRange(sourceFile, symbol)
  return range === undefined ? undefined : sourceFile.text.slice(range.start, range.end)
}

// Syntax errors only: the replacement is checked for parseability before it is
// written, and for type errors afterwards by the `check` tool. Reported as a
// count and a first message, which is all a caller can act on.
export const syntaxErrorIn = (source: string): string | undefined => {
  const output = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, isolatedModules: true },
    fileName: 'candidate.ts',
  })
  const first = (output.diagnostics ?? []).find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  )
  return first === undefined
    ? undefined
    : ts.flattenDiagnosticMessageText(first.messageText, ' ')
}
