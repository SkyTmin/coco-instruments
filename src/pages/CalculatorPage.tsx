import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Screen, SectionHeader } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { CalculatorError, evaluateExpression, formatCalculatorNumber, toCalculatorInputNumber } from '@/lib/calculator';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

type CalcButtonTone = 'soft' | 'op' | 'danger' | 'equals' | 'ghost';

interface CalcButton {
  label: string;
  aria?: string;
  tone?: CalcButtonTone;
  wide?: boolean;
  onClick: () => void;
}

const SWIPE_THRESHOLD = 34;
const DOUBLE_TAP_MS = 280;

function normalizeInputNumber(value: number): string {
  return toCalculatorInputNumber(value).replace('.', ',');
}

function displayExpression(expression: string, cursor: number) {
  const safeCursor = Math.max(0, Math.min(expression.length, cursor));
  return {
    before: expression.slice(0, safeCursor) || '',
    after: expression.slice(safeCursor) || '',
  };
}

function errorText(error: unknown): string {
  if (error instanceof CalculatorError) return error.message;
  return 'Ошибка';
}

export function CalculatorPage() {
  const history = useFinanceStore((s) => s.calculatorHistory);
  const prefs = useFinanceStore((s) => s.calculatorPrefs);
  const addHistory = useFinanceStore((s) => s.addCalculatorHistory);
  const clearHistory = useFinanceStore((s) => s.clearCalculatorHistory);
  const setPrefs = useFinanceStore((s) => s.setCalculatorPrefs);

  const [expression, setExpression] = useState('');
  const [cursor, setCursor] = useState(0);
  const [resultLine, setResultLine] = useState('');
  const [status, setStatus] = useState('');
  const gesture = useRef<{ x: number; y: number; pointerId: number; moved: boolean } | null>(null);
  const lastTapAt = useRef(0);

  const shown = displayExpression(expression, cursor);
  const preview = useMemo(() => {
    if (!expression.trim()) return '';
    try {
      return evaluateExpression(expression, {
        ans: prefs.lastAns,
        angleMode: prefs.angleMode,
      }).formatted;
    } catch {
      return '';
    }
  }, [expression, prefs.angleMode, prefs.lastAns]);

  const setFormula = (next: string, nextCursor = next.length) => {
    setExpression(next);
    setCursor(Math.max(0, Math.min(next.length, nextCursor)));
    setStatus('');
  };

  const insertText = (text: string, offset = text.length) => {
    const next = `${expression.slice(0, cursor)}${text}${expression.slice(cursor)}`;
    setFormula(next, cursor + offset);
    selectionChanged();
  };

  const insertOperation = (op: '+' | '−' | '×' | '÷') => {
    const left = expression.slice(0, cursor);
    const right = expression.slice(cursor);
    const needsLeftSpace = left.length > 0 && !/\s$/.test(left);
    const needsRightSpace = right.length > 0 && !/^\s/.test(right);
    const text = `${needsLeftSpace ? ' ' : ''}${op}${needsRightSpace ? ' ' : ' '}`;
    insertText(text);
    tapMedium();
  };

  const insertFunction = (name: string) => {
    insertText(`${name}()`, name.length + 1);
  };

  const deleteChar = () => {
    if (cursor <= 0) return;
    const next = `${expression.slice(0, cursor - 1)}${expression.slice(cursor)}`;
    setFormula(next, cursor - 1);
    tapLight();
  };

  const clear = () => {
    setFormula('');
    setResultLine('');
    tapLight();
  };

  const moveCursor = (delta: number) => {
    setCursor((value) => Math.max(0, Math.min(expression.length, value + delta)));
    selectionChanged();
  };

  const evaluateCurrent = () => {
    const raw = expression.trim();
    if (!raw) return;
    try {
      const result = evaluateExpression(raw, {
        ans: prefs.lastAns,
        angleMode: prefs.angleMode,
      });
      addHistory(raw, result.formatted, result.value);
      const next = normalizeInputNumber(result.value);
      setFormula(next);
      setResultLine(result.formatted);
      notifySuccess();
    } catch (error) {
      const message = errorText(error);
      setStatus(message);
      setResultLine('');
      notifyWarning();
    }
  };

  const currentValue = () => {
    try {
      return evaluateExpression(expression || 'Ans', {
        ans: prefs.lastAns,
        angleMode: prefs.angleMode,
      }).value;
    } catch {
      return prefs.lastAns;
    }
  };

  const memory = (action: 'clear' | 'recall' | 'plus' | 'minus') => {
    if (action === 'clear') {
      setPrefs({ memory: 0 });
      tapLight();
      return;
    }
    if (action === 'recall') {
      insertText(normalizeInputNumber(prefs.memory));
      return;
    }
    const value = currentValue();
    setPrefs({ memory: action === 'plus' ? prefs.memory + value : prefs.memory - value });
    tapLight();
  };

  const toggleAngleMode = () => {
    setPrefs({ angleMode: prefs.angleMode === 'DEG' ? 'RAD' : 'DEG' });
    selectionChanged();
  };

  const handleGestureStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleGestureMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) start.moved = true;
    if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) event.preventDefault();
  };

  const handleGestureEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    gesture.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.max(absX, absY) >= SWIPE_THRESHOLD) {
      if (absX > absY) insertOperation(dx > 0 ? '+' : '−');
      else insertOperation(dy > 0 ? '÷' : '×');
      return;
    }

    if (start.moved) return;
    const now = Date.now();
    if (now - lastTapAt.current <= DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      evaluateCurrent();
      return;
    }
    lastTapAt.current = now;
  };

  const handleGestureCancel = () => {
    gesture.current = null;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        insertText(event.key);
      } else if (event.key === '.' || event.key === ',') {
        event.preventDefault();
        insertText(',');
      } else if (event.key === '+') {
        event.preventDefault();
        insertOperation('+');
      } else if (event.key === '-') {
        event.preventDefault();
        insertOperation('−');
      } else if (event.key === '*') {
        event.preventDefault();
        insertOperation('×');
      } else if (event.key === '/') {
        event.preventDefault();
        insertOperation('÷');
      } else if (event.key === 'Enter' || event.key === '=') {
        event.preventDefault();
        evaluateCurrent();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        deleteChar();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveCursor(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveCursor(1);
      } else if (event.key === '(' || event.key === ')') {
        event.preventDefault();
        insertText(event.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const memoryButtons: CalcButton[] = [
    { label: 'MC', aria: 'Очистить память', tone: 'ghost', onClick: () => memory('clear') },
    { label: 'MR', aria: 'Вставить память', tone: 'ghost', onClick: () => memory('recall') },
    { label: 'M+', aria: 'Добавить в память', tone: 'ghost', onClick: () => memory('plus') },
    { label: 'M−', aria: 'Вычесть из памяти', tone: 'ghost', onClick: () => memory('minus') },
  ];

  const scienceButtons: CalcButton[] = [
    { label: prefs.angleMode, aria: 'Переключить градусы и радианы', tone: 'op', onClick: toggleAngleMode },
    { label: 'sin', onClick: () => insertFunction('sin') },
    { label: 'cos', onClick: () => insertFunction('cos') },
    { label: 'tan', onClick: () => insertFunction('tan') },
    { label: 'asin', onClick: () => insertFunction('asin') },
    { label: 'acos', onClick: () => insertFunction('acos') },
    { label: 'atan', onClick: () => insertFunction('atan') },
    { label: 'ln', onClick: () => insertFunction('ln') },
    { label: 'log', onClick: () => insertFunction('log') },
    { label: '√', aria: 'Квадратный корень', onClick: () => insertFunction('sqrt') },
    { label: 'x²', aria: 'Квадрат', onClick: () => insertText('^2') },
    { label: 'xʸ', aria: 'Степень', onClick: () => insertText('^') },
    { label: 'abs', onClick: () => insertFunction('abs') },
    { label: '!', aria: 'Факториал', onClick: () => insertText('!') },
    { label: '%', aria: 'Процент', onClick: () => insertText('%') },
    { label: 'π', aria: 'Пи', onClick: () => insertText('π') },
    { label: 'e', aria: 'Число e', onClick: () => insertText('e') },
  ];

  const mainButtons: CalcButton[] = [
    { label: 'AC', tone: 'danger', onClick: clear },
    { label: 'DEL', aria: 'Удалить', tone: 'soft', onClick: deleteChar },
    { label: '←', aria: 'Курсор влево', tone: 'soft', onClick: () => moveCursor(-1) },
    { label: '→', aria: 'Курсор вправо', tone: 'soft', onClick: () => moveCursor(1) },
    { label: '(', tone: 'soft', onClick: () => insertText('(') },
    { label: ')', tone: 'soft', onClick: () => insertText(')') },
    { label: 'Ans', tone: 'soft', onClick: () => insertText('Ans') },
    { label: '÷', tone: 'op', onClick: () => insertOperation('÷') },
    { label: '7', onClick: () => insertText('7') },
    { label: '8', onClick: () => insertText('8') },
    { label: '9', onClick: () => insertText('9') },
    { label: '×', tone: 'op', onClick: () => insertOperation('×') },
    { label: '4', onClick: () => insertText('4') },
    { label: '5', onClick: () => insertText('5') },
    { label: '6', onClick: () => insertText('6') },
    { label: '−', tone: 'op', onClick: () => insertOperation('−') },
    { label: '1', onClick: () => insertText('1') },
    { label: '2', onClick: () => insertText('2') },
    { label: '3', onClick: () => insertText('3') },
    { label: '+', tone: 'op', onClick: () => insertOperation('+') },
    { label: '0', wide: true, onClick: () => insertText('0') },
    { label: ',', aria: 'Запятая', onClick: () => insertText(',') },
    { label: '=', tone: 'equals', onClick: evaluateCurrent },
  ];

  return (
    <Screen
      title="Калькулятор"
      subtitle="Свайпы, формулы и история"
      action={
        <button className="calc-mode" type="button" onClick={toggleAngleMode}>
          {prefs.angleMode}
        </button>
      }
    >
      <div className="calculator-page">
        <div
          className="calc-shell"
          onPointerDown={handleGestureStart}
          onPointerMove={handleGestureMove}
          onPointerUp={handleGestureEnd}
          onPointerCancel={handleGestureCancel}
        >
          <div className="calc-display" aria-live="polite">
            <div className={`calc-display__formula${expression ? '' : ' is-empty'}`}>
              {expression ? (
                <>
                  <span>{shown.before}</span>
                  <span className="calc-cursor" />
                  <span>{shown.after}</span>
                </>
              ) : (
                <>
                  <span>0</span>
                  <span className="calc-cursor" />
                </>
              )}
            </div>
            <div className={`calc-display__result${status ? ' is-error' : ''}`}>
              {status || resultLine || (preview ? `≈ ${preview}` : formatCalculatorNumber(prefs.lastAns))}
            </div>
          </div>

          <div className="calc-gesture-map" aria-hidden="true">
            <span>×</span>
            <span>−</span>
            <span>=</span>
            <span>+</span>
            <span>÷</span>
          </div>

          <div className="calc-memory">
            {memoryButtons.map((button) => (
              <CalcKey key={button.label} button={button} />
            ))}
          </div>

          <div className="calc-science">
            {scienceButtons.map((button) => (
              <CalcKey key={button.label} button={button} />
            ))}
          </div>

          <div className="calc-keypad">
            {mainButtons.map((button) => (
              <CalcKey key={button.label} button={button} />
            ))}
          </div>
        </div>

        <div className="calc-history">
          <SectionHeader
            title="История"
            action={
              history.length ? (
                <button className="calc-history__clear" type="button" onClick={clearHistory}>
                  Очистить
                </button>
              ) : null
            }
          />
          {history.length ? (
            <div className="calc-history__list">
              {history.map((item) => (
                <button
                  key={item.id}
                  className="calc-history__item"
                  type="button"
                  onClick={() => {
                    setFormula(item.expression);
                    setResultLine(item.result);
                    tapLight();
                  }}
                >
                  <span>{item.expression}</span>
                  <b>{item.result}</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="calc-empty">
              <b>Пока пусто</b>
              <span>Первые вычисления появятся здесь.</span>
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}

function CalcKey({ button }: { button: CalcButton }) {
  return (
    <button
      type="button"
      aria-label={button.aria ?? button.label}
      className={`calc-key calc-key--${button.tone ?? 'soft'}${button.wide ? ' calc-key--wide' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        button.onClick();
      }}
    >
      {button.label}
    </button>
  );
}
