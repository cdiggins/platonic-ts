import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { expressionShape, sameShape, type Shape, type ShapeOptions } from '../src/shapes.ts'

// The source is wrapped in parentheses so that object literals and arrows parse as
// expressions rather than blocks; `expressionShape` normalizes the wrapper away.
const parseExpression = (source: string): ts.Expression => {
  const file = ts.createSourceFile('sample.ts', `(${source});`, ts.ScriptTarget.Latest, true)
  const statement = file.statements[0]
  if (statement === undefined || !ts.isExpressionStatement(statement))
    throw new Error(`not an expression: ${source}`)
  return statement.expression
}

const shapeOf = (source: string, options?: ShapeOptions): Shape =>
  options === undefined
    ? expressionShape(parseExpression(source))
    : expressionShape(parseExpression(source), options)

const keyOf = (source: string, options?: ShapeOptions): string => shapeOf(source, options).key

const alike = (left: string, right: string): boolean =>
  sameShape(parseExpression(left), parseExpression(right))

describe('expressionShape', () => {
  it('gives renamed expressions the same key and reports their own names', () => {
    expect(alike('xs.map((item) => item.id)', 'rows.map((row) => row.id)')).toBe(true)
    expect(shapeOf('xs.map((item) => item.id)').parameters).toEqual(['xs'])
    expect(shapeOf('rows.map((row) => row.id)').parameters).toEqual(['rows'])
  })

  it('separates one variable used twice from two variables', () => {
    expect(alike('add(a, a)', 'add(b, b)')).toBe(true)
    expect(alike('add(a, a)', 'add(a, b)')).toBe(false)
    expect(shapeOf('add(a, b)').parameters).toEqual(['add', 'a', 'b'])
  })

  it('numbers free names in the order they are first seen', () => {
    expect(shapeOf('first + second + first').parameters).toEqual(['first', 'second'])
    // Order lives in the parameter list, not in the key: `a - b` and `b - a` are the same
    // shape called with the arguments swapped.
    expect(keyOf('first - second')).toBe(keyOf('second - first'))
    expect(shapeOf('second - first').parameters).toEqual(['second', 'first'])
  })

  it('keeps property names, because renaming one changes what the code reads', () => {
    expect(alike('area(shape.width, shape.height)', 'area(box.width, box.height)')).toBe(true)
    expect(alike('area(shape.width, shape.height)', 'area(box.left, box.right)')).toBe(false)
  })

  it('records the field name and the variable of a shorthand property', () => {
    expect(alike('({ total: a })', '({ total: b })')).toBe(true)
    expect(alike('({ total: a })', '({ count: a })')).toBe(false)
    expect(shapeOf('({ total })').parameters).toEqual(['total'])
  })

  it('normalizes parentheses away but not the grouping they express', () => {
    expect(alike('(a + b) * c', '((a) + (b)) * (c)')).toBe(true)
    expect(alike('(a + b) * c', 'a + b * c')).toBe(false)
  })

  it('distinguishes operators', () => {
    expect(alike('total(a + b)', 'total(x + y)')).toBe(true)
    expect(alike('total(a + b)', 'total(x - y)')).toBe(false)
  })
})

describe('expressionShape binders', () => {
  it('does not count a name the expression binds itself as a parameter', () => {
    expect(shapeOf('xs.filter((item) => item.active)').parameters).toEqual(['xs'])
    expect(
      shapeOf('xs.map((item) => { const id = item.id; return id + suffix })').parameters,
    ).toEqual(['xs', 'suffix'])
  })

  it('binds destructured parameters', () => {
    expect(shapeOf('xs.map(({ id, name }) => id + name)').parameters).toEqual(['xs'])
    expect(alike('xs.map(({ id, name }) => id + name)', 'ys.map(({ id, name }) => id + name)')).toBe(
      true,
    )
  })

  it('resolves a name to its innermost binder, so shadowing shows in the key', () => {
    expect(alike('(a) => (b) => a(b)', '(x) => (y) => x(y)')).toBe(true)
    expect(alike('(a) => (b) => a(b)', '(a) => (b) => b(a)')).toBe(false)
    expect(alike('(a) => (a) => a', '(a) => (b) => b')).toBe(true)
    expect(alike('(a) => (a) => a', '(a) => (b) => a')).toBe(false)
  })

  it('binds a loop variable and a catch variable inside a block body', () => {
    expect(shapeOf('() => { for (const row of rows) { use(row) } }').parameters).toEqual([
      'rows',
      'use',
    ])
    expect(shapeOf('() => { try { risky() } catch (error) { report(error) } }').parameters).toEqual([
      'risky',
      'report',
    ])
  })
})

describe('expressionShape literals and types', () => {
  it('keeps literal values by default and abstracts them on request', () => {
    expect(alike('slice(list, 0, 1)', 'slice(other, 0, 1)')).toBe(true)
    expect(alike('slice(list, 0, 1)', 'slice(list, 0, 2)')).toBe(false)
    expect(keyOf('slice(list, 0, 1)', { literals: 'abstract' })).toBe(
      keyOf('slice(other, 0, 2)', { literals: 'abstract' }),
    )
  })

  it('keeps type names, and does not mistake one for a parameter', () => {
    expect(alike('read(count as Meters)', 'read(total as Meters)')).toBe(true)
    expect(alike('read(count as Meters)', 'read(count as Seconds)')).toBe(false)
    expect(shapeOf('read(count as Meters)').parameters).toEqual(['read', 'count'])
  })
})
