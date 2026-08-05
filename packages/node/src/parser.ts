export type MaceScalar = string | number | boolean
export type MaceValue = MaceScalar | MaceValue[] | MaceRecord
export type MaceRecord = { [field: string]: MaceValue }
export type ParseOptions = { input?: string }

type Token = {
  kind: 'identifier' | 'number' | 'string' | 'symbol' | 'eof'
  value: string
  line: number
  column: number
}

const binaryPrecedence: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '**': 7,
}

export function parseMace(source: string, options: ParseOptions = {}): MaceRecord {
  const parser = new Parser(tokenize(source), parseInput(options.input))
  return parser.parseFile()
}

function parseInput(input?: string): MaceRecord {
  if (!input) {
    return {}
  }

  const parser = new ExpressionParser(tokenize(input), {}, {})
  const value = parser.parseExpression()
  if (!isRecord(value)) {
    throw new Error('runtime input must be a Mace record literal')
  }
  return value
}

class Parser {
  private index = 0
  private readonly variables: MaceRecord = {}
  private readonly tokens: Token[]
  private readonly input: MaceRecord

  constructor(tokens: Token[], input: MaceRecord) {
    this.tokens = tokens
    this.input = input
  }

  parseFile(): MaceRecord {
    if (this.isScriptDelimiter()) {
      this.parseScript()
    }

    if (this.match('[')) {
      this.skipBalanced('[', ']')
    }

    const output = this.parseRecord(this.variables)
    this.expect('eof')
    return output
  }

  private parseScript(): void {
    this.consumeScriptDelimiter()
    while (!this.isScriptDelimiter()) {
      if (this.current().kind === 'eof') {
        this.fail(this.current(), 'expected closing script delimiter')
      }

      const declaration = this.collectDeclaration()
      this.evaluateDeclaration(declaration)
    }
    this.consumeScriptDelimiter()
  }

  private collectDeclaration(): Token[] {
    const declaration: Token[] = []
    let depth = 0
    while (this.current().kind !== 'eof') {
      if (depth === 0 && this.isScriptDelimiter()) return declaration
      const token = this.advance()
      if (token.value === '{' || token.value === '[' || token.value === '<' || token.value === '(') {
        depth++
      }
      if (token.value === '}' || token.value === ']' || token.value === '>' || token.value === ')') {
        depth--
      }
      if (token.value === ';' && depth === 0) {
        return declaration
      }
      declaration.push(token)
    }

    this.fail(this.current(), 'expected declaration terminator')
  }

  private evaluateDeclaration(declaration: Token[]): void {
    if (!declaration.length || declaration[0].value === 'schema' || declaration[0].value === 'alias' || declaration[0].value === 'from' || declaration[0].value === 'gen_doc' || declaration[0].value === 'schema_doc') {
      return
    }

    const assignment = declaration.findIndex((token) => token.value === '=')
    if (assignment < 1) {
      return
    }

    const name = declaration[assignment - 1]
    if (name.kind !== 'identifier') {
      this.fail(name, 'expected variable name')
    }

    const expression = declaration.slice(assignment + 1)
    this.variables[name.value] = new ExpressionParser(expression, this.variables, this.input).parseExpression()
  }

  private parseRecord(self: MaceRecord): MaceRecord {
    this.expect('{')
    const fields: MaceRecord = {}
    while (!this.match('}')) {
      const name = this.expectIdentifier()
      let value: MaceValue
      if (this.match(':')) {
        const expression = this.remainingUntilFieldEnd()
        value = new ExpressionParser([...expression, this.current()], this.variables, this.input, self).parseExpression()
      } else {
        value = this.variables[name.value]
        if (value === undefined) {
          this.fail(name, `unknown identifier ${name.value}`)
        }
      }
      fields[name.value] = value
      Object.assign(self, fields)
      this.match(',')
    }
    return fields
  }

  private remainingUntilFieldEnd(): Token[] {
    const expression: Token[] = []
    let depth = 0
    while (this.current().kind !== 'eof') {
      const token = this.current()
      if (depth === 0 && (token.value === ',' || token.value === '}')) {
        return expression
      }
      this.advance()
      if (token.value === '{' || token.value === '[' || token.value === '(') depth++
      if (token.value === '}' || token.value === ']' || token.value === ')') depth--
      expression.push(token)
    }
    this.fail(this.current(), 'expected field terminator')
  }

  private isScriptDelimiter(): boolean {
    if (this.current().value !== '|') return false
    let cursor = this.index + 1
    let equals = 0
    while (/^=+$/.test(this.tokens[cursor]?.value || '')) {
      equals += this.tokens[cursor].value.length
      cursor++
    }
    return equals >= 3 && this.tokens[cursor]?.value === '|'
  }

  private consumeScriptDelimiter(): void {
    this.expect('|')
    let equals = 0
    while (/^=+$/.test(this.current().value)) equals += this.advance().value.length
    if (equals < 3) this.fail(this.current(), 'expected script delimiter')
    this.expect('|')
  }

  private skipBalanced(open: string, close: string): void {
    let depth = 1
    while (depth > 0) {
      const token = this.advance()
      if (token.kind === 'eof') this.fail(token, `expected ${close}`)
      if (token.value === open) depth++
      if (token.value === close) depth--
    }
  }

  private current(): Token {
    return this.tokens[this.index]
  }

  private advance(): Token {
    return this.tokens[this.index++]
  }

  private match(value: string): boolean {
    if (this.current().value !== value) return false
    this.advance()
    return true
  }

  private expect(value: string | 'eof'): Token {
    const token = this.current()
    if ((value === 'eof' && token.kind === 'eof') || token.value === value) return this.advance()
    this.fail(token, `expected ${value}`)
  }

  private expectIdentifier(): Token {
    const token = this.current()
    if (token.kind === 'identifier') return this.advance()
    this.fail(token, 'expected field name')
  }

  private fail(token: Token, message: string): never {
    throw new Error(`parser: ${message} at ${token.line}:${token.column} near ${JSON.stringify(token.value)}`)
  }
}

class ExpressionParser {
  private index = 0
  private readonly tokens: Token[]
  private readonly variables: MaceRecord
  private readonly input: MaceRecord
  private readonly self: MaceRecord

  constructor(tokens: Token[], variables: MaceRecord, input: MaceRecord, self: MaceRecord = {}) {
    this.tokens = tokens
    this.variables = variables
    this.input = input
    this.self = self
  }

  parseExpression(minimumPrecedence = 0): MaceValue {
    let value = this.parseUnary()
    while (true) {
      const operator = this.current().value
      const precedence = binaryPrecedence[operator]
      if (precedence === undefined || precedence < minimumPrecedence) break
      this.advance()
      const right = this.parseExpression(precedence + (operator === '**' ? 0 : 1))
      value = evaluateBinary(operator, value, right)
    }
    if (minimumPrecedence === 0 && this.match('?')) {
      const whenTrue = this.parseExpression()
      this.expect(':')
      const whenFalse = this.parseExpression()
      return value ? whenTrue : whenFalse
    }
    return value
  }

  private parseUnary(): MaceValue {
    if (this.match('!')) return !this.parseUnary()
    if (this.match('-')) return -asNumber(this.parseUnary())
    if (this.match('+')) return asNumber(this.parseUnary())
    return this.parsePostfix()
  }

  private parsePostfix(): MaceValue {
    let value = this.parsePrimary()
    while (this.match('.') || this.match('?.')) {
      const name = this.expectIdentifier()
      if (!isRecord(value)) {
        throw new Error(`parser: cannot access member ${name.value}`)
      }
      value = value[name.value]
      if (value === undefined) throw new Error(`parser: unknown field ${name.value}`)
    }
    return value
  }

  private parsePrimary(): MaceValue {
    const token = this.advance()
    if (token.kind === 'number') return token.value.includes('.') ? Number(token.value) : Number.parseInt(token.value, 10)
    if (token.kind === 'string') return interpolate(token.value, this.variables, this.input, this.self)
    if (token.value === 'true') return true
    if (token.value === 'false') return false
    if (token.value === '(') {
      const value = this.parseExpression()
      this.expect(')')
      return value
    }
    if (token.value === '[') return this.parseArray()
    if (token.value === '{') return this.parseRecord()
    if (token.value === '$') {
      const name = this.expectIdentifier()
      if (name.value === 'self') {
        this.expect('.')
        return this.readField(this.self, this.expectIdentifier())
      }
      return this.readField(this.input, name)
    }
    if (token.kind === 'identifier') return this.readField(this.variables, token)
    throw new Error(`parser: expected expression at ${token.line}:${token.column} near ${JSON.stringify(token.value)}`)
  }

  private parseArray(): MaceValue[] {
    const values: MaceValue[] = []
    while (!this.match(']')) {
      values.push(this.parseExpression())
      if (!this.match(',')) this.expect(']')
    }
    return values
  }

  private parseRecord(): MaceRecord {
    const record: MaceRecord = {}
    while (!this.match('}')) {
      const name = this.expectIdentifier()
      if (this.match(':')) {
        record[name.value] = this.parseExpression()
      } else {
        record[name.value] = this.readField(this.variables, name)
      }
      if (!this.match(',')) this.expect('}')
    }
    return record
  }

  private readField(record: MaceRecord, token: Token): MaceValue {
    const value = record[token.value]
    if (value === undefined) throw new Error(`parser: unknown identifier ${token.value} at ${token.line}:${token.column}`)
    return value
  }

  private current(): Token {
    return this.tokens[this.index] ?? { kind: 'eof', value: '', line: 0, column: 0 }
  }

  private advance(): Token {
    const token = this.current()
    this.index++
    return token
  }

  private match(value: string): boolean {
    if (this.current().value !== value) return false
    this.advance()
    return true
  }

  private expect(value: string): Token {
    if (this.current().value === value) return this.advance()
    const token = this.current()
    throw new Error(`parser: expected ${value} at ${token.line}:${token.column} near ${JSON.stringify(token.value)}`)
  }

  private expectIdentifier(): Token {
    const token = this.advance()
    if (token.kind === 'identifier') return token
    throw new Error(`parser: expected identifier at ${token.line}:${token.column} near ${JSON.stringify(token.value)}`)
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  let line = 1
  let column = 1
  const add = (kind: Token['kind'], value: string, tokenLine = line, tokenColumn = column) => tokens.push({ kind, value, line: tokenLine, column: tokenColumn })
  const advance = () => {
    const character = source[index++]
    if (character === '\n') {
      line++
      column = 1
    } else {
      column++
    }
    return character
  }

  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      advance()
      continue
    }
    if (source.startsWith('//', index)) {
      while (index < source.length && advance() !== '\n') {}
      continue
    }
    if (source.startsWith('/*', index)) {
      advance(); advance()
      while (index < source.length && !source.startsWith('*/', index)) advance()
      advance(); advance()
      continue
    }
    const tokenLine = line
    const tokenColumn = column
    if (character === '"' || character === "'") {
      const quote = advance()
      let value = ''
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          advance()
          const escaped = advance()
          value += ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[escaped] ?? escaped
        } else {
          value += advance()
        }
      }
      if (source[index] !== quote) throw new Error(`parser: unterminated string at ${tokenLine}:${tokenColumn}`)
      advance()
      add('string', value, tokenLine, tokenColumn)
      continue
    }
    if (/[0-9]/.test(character)) {
      let value = ''
      while (index < source.length && /[0-9.]/.test(source[index])) value += advance()
      add('number', value, tokenLine, tokenColumn)
      continue
    }
    if (/[\p{L}_]/u.test(character)) {
      let value = ''
      while (index < source.length && /[\p{L}\p{N}_-]/u.test(source[index])) value += advance()
      add('identifier', value, tokenLine, tokenColumn)
      continue
    }
    const operator = ['?.', '??', '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '**'].find((value) => source.startsWith(value, index))
    if (operator) {
      for (let offset = 0; offset < operator.length; offset++) advance()
      add('symbol', operator, tokenLine, tokenColumn)
      continue
    }
    advance()
    add('symbol', character, tokenLine, tokenColumn)
  }
  add('eof', '', line, column)
  return tokens
}

function interpolate(value: string, variables: MaceRecord, input: MaceRecord, self: MaceRecord): string {
  return value.replace(/\$\((.*?)\)/g, (_, expression) => String(new ExpressionParser(tokenize(expression), variables, input, self).parseExpression()))
}

function evaluateBinary(operator: string, left: MaceValue, right: MaceValue): MaceValue {
  switch (operator) {
    case '+': return asNumber(left) + asNumber(right)
    case '-': return asNumber(left) - asNumber(right)
    case '*': return asNumber(left) * asNumber(right)
    case '/': return asNumber(left) / asNumber(right)
    case '%': return asNumber(left) % asNumber(right)
    case '**': return asNumber(left) ** asNumber(right)
    case '==': return left === right
    case '!=': return left !== right
    case '<': return asNumber(left) < asNumber(right)
    case '<=': return asNumber(left) <= asNumber(right)
    case '>': return asNumber(left) > asNumber(right)
    case '>=': return asNumber(left) >= asNumber(right)
    case '&&': return Boolean(left) && Boolean(right)
    case '||': return Boolean(left) || Boolean(right)
    default: throw new Error(`parser: unsupported operator ${operator}`)
  }
}

function asNumber(value: MaceValue): number {
  if (typeof value !== 'number') throw new Error('parser: expected numeric value')
  return value
}

function isRecord(value: MaceValue): value is MaceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
