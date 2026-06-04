import { describe, expect, it } from 'vitest';
import { CalculatorError, evaluateExpression } from './calculator';

describe('calculator evaluator', () => {
  it('handles basic arithmetic and precedence', () => {
    expect(evaluateExpression('2+2').value).toBe(4);
    expect(evaluateExpression('2+3×4').value).toBe(14);
    expect(evaluateExpression('(2+3)×4').value).toBe(20);
    expect(evaluateExpression('-5+2').value).toBe(-3);
  });

  it('rejects division by zero', () => {
    expect(() => evaluateExpression('10÷0')).toThrow(new CalculatorError('Деление на ноль'));
  });

  it('supports functions and angle modes', () => {
    expect(evaluateExpression('sqrt(9)').value).toBe(3);
    expect(evaluateExpression('sin(30)', { angleMode: 'DEG' }).value).toBe(0.5);
    expect(evaluateExpression('sin(pi/2)', { angleMode: 'RAD' }).value).toBe(1);
  });

  it('supports percent, factorial and powers', () => {
    expect(evaluateExpression('50%').value).toBe(0.5);
    expect(evaluateExpression('5!').value).toBe(120);
    expect(evaluateExpression('2^3^2').value).toBe(512);
  });

  it('supports Ans', () => {
    expect(evaluateExpression('Ans×2+1', { ans: 7 }).value).toBe(15);
  });

  it('reports bracket errors', () => {
    expect(() => evaluateExpression('(2+3')).toThrow(new CalculatorError('Проверьте скобки'));
  });
});
