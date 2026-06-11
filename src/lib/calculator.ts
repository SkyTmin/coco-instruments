export type AngleMode = 'DEG' | 'RAD';

export interface CalculatorEvalOptions {
  ans?: number;
  angleMode?: AngleMode;
}

export interface CalculatorEvalResult {
  value: number;
  formatted: string;
}

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculatorError';
  }
}

type OperatorTokenValue = '+' | '-' | '*' | '/' | '^' | '%' | '!';

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: OperatorTokenValue }
  | { type: 'paren'; value: '(' | ')' };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
};

const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'ln',
  'log',
  'sqrt',
  'abs',
]);

function normalizeExpression(input: string): string {
  return input
    .replace(/,/g, '.')
    .replace(/[×xX]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√/g, 'sqrt');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAlpha(ch: string): boolean {
  return /[A-Za-zА-Яа-яЁёπ]/.test(ch);
}

export function tokenizeExpression(input: string): Token[] {
  const source = normalizeExpression(input);
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (isDigit(ch) || ch === '.') {
      let raw = '';
      let dots = 0;
      while (i < source.length && (isDigit(source[i]) || source[i] === '.')) {
        if (source[i] === '.') dots += 1;
        if (dots > 1) throw new CalculatorError('Проверьте число');
        raw += source[i];
        i += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new CalculatorError('Проверьте число');
      tokens.push({ type: 'number', value });
      continue;
    }

    if (isAlpha(ch)) {
      let raw = '';
      while (i < source.length && isAlpha(source[i])) {
        raw += source[i];
        i += 1;
      }
      tokens.push({ type: 'identifier', value: raw.toLowerCase() });
      continue;
    }

    if ('+-*/^%!'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch as OperatorTokenValue });
      i += 1;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
      continue;
    }

    throw new CalculatorError(`Не понимаю "${ch}"`);
  }

  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private readonly ans: number;
  private readonly angleMode: AngleMode;
  private pos = 0;

  constructor(tokens: Token[], options: CalculatorEvalOptions) {
    this.tokens = tokens;
    this.ans = options.ans ?? 0;
    this.angleMode = options.angleMode ?? 'DEG';
  }

  parse(): number {
    if (!this.tokens.length) throw new CalculatorError('Введите выражение');
    const value = this.parseExpression();
    if (!this.isEnd()) throw new CalculatorError('Проверьте выражение');
    return this.clean(value);
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const op = this.previous().value;
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parsePower();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const op = this.previous().value;
      const right = this.parsePower();
      if (op === '/' && Math.abs(right) < Number.EPSILON)
        throw new CalculatorError('Деление на ноль');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private parsePower(): number {
    let left = this.parseUnary();
    if (this.matchOperator('^')) {
      const right = this.parsePower();
      left = Math.pow(left, right);
    }
    return left;
  }

  private parseUnary(): number {
    if (this.matchOperator('+')) return this.parseUnary();
    if (this.matchOperator('-')) return -this.parseUnary();
    return this.parsePostfix();
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    let used = true;
    while (used) {
      used = false;
      if (this.matchOperator('%')) {
        value /= 100;
        used = true;
      }
      if (this.matchOperator('!')) {
        value = factorial(value);
        used = true;
      }
    }
    return value;
  }

  private parsePrimary(): number {
    const token = this.peek();
    if (token?.type === 'number') {
      this.pos += 1;
      return token.value;
    }

    if (token?.type === 'identifier') {
      this.pos += 1;
      const name = token.value;
      if (name === 'ans') return this.ans;
      if (name in CONSTANTS) return CONSTANTS[name];
      if (!FUNCTIONS.has(name)) throw new CalculatorError(`Не знаю функцию ${name}`);
      this.consumeParen('(');
      const arg = this.parseExpression();
      this.consumeParen(')');
      return this.applyFunction(name, arg);
    }

    if (this.matchParen('(')) {
      const value = this.parseExpression();
      this.consumeParen(')');
      return value;
    }

    throw new CalculatorError('Проверьте выражение');
  }

  private applyFunction(name: string, value: number): number {
    const radians = this.angleMode === 'DEG' ? (value * Math.PI) / 180 : value;
    switch (name) {
      case 'sin':
        return Math.sin(radians);
      case 'cos':
        return Math.cos(radians);
      case 'tan':
        return Math.tan(radians);
      case 'asin': {
        const v = Math.asin(value);
        return this.angleMode === 'DEG' ? (v * 180) / Math.PI : v;
      }
      case 'acos': {
        const v = Math.acos(value);
        return this.angleMode === 'DEG' ? (v * 180) / Math.PI : v;
      }
      case 'atan': {
        const v = Math.atan(value);
        return this.angleMode === 'DEG' ? (v * 180) / Math.PI : v;
      }
      case 'ln':
        if (value <= 0) throw new CalculatorError('Логарифм только для положительных');
        return Math.log(value);
      case 'log':
        if (value <= 0) throw new CalculatorError('Логарифм только для положительных');
        return Math.log10(value);
      case 'sqrt':
        if (value < 0) throw new CalculatorError('Корень только из положительных');
        return Math.sqrt(value);
      case 'abs':
        return Math.abs(value);
      default:
        throw new CalculatorError('Не знаю функцию');
    }
  }

  private clean(value: number): number {
    if (!Number.isFinite(value)) throw new CalculatorError('Ошибка');
    const rounded = Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(14));
    if (!Number.isFinite(rounded)) throw new CalculatorError('Ошибка');
    return rounded;
  }

  private matchOperator(value: OperatorTokenValue): boolean {
    if (this.peek()?.type === 'operator' && this.peek()?.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private matchParen(value: '(' | ')'): boolean {
    if (this.peek()?.type === 'paren' && this.peek()?.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private matchType<T extends Token['type']>(type: T): boolean {
    if (this.peek()?.type === type) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private consumeParen(value: '(' | ')'): void {
    if (!this.matchParen(value)) throw new CalculatorError('Проверьте скобки');
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isEnd(): boolean {
    return this.pos >= this.tokens.length;
  }
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0)
    throw new CalculatorError('Факториал только для целых');
  if (value > 170) throw new CalculatorError('Слишком большое число');
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

export function evaluateExpression(
  input: string,
  options: CalculatorEvalOptions = {},
): CalculatorEvalResult {
  const parser = new Parser(tokenizeExpression(input), options);
  const value = parser.parse();
  return { value, formatted: formatCalculatorNumber(value) };
}

export function formatCalculatorNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Ошибка';
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1_000_000_000 ? 4 : 10;
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits,
    useGrouping: true,
  }).format(value);
}

export function toCalculatorInputNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toPrecision(14)));
}
