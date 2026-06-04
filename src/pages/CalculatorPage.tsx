import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Screen, Sheet } from '@/components/ui';
import { IconClock, IconGear } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CalculatorError, evaluateExpression, toCalculatorInputNumber } from '@/lib/calculator';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

type Op = '+' | '−' | '×' | '÷';

const SWIPE_THRESHOLD = 36;
const DIR_THRESHOLD = 14;
const MOVE_TOLERANCE = 7;
const DOUBLE_TAP_MS = 300;

const STEPS: { dir: 'right' | 'left' | 'up' | 'down' | 'tap'; op: Op | '='; title: string; desc: string }[] = [
  { dir: 'right', op: '+', title: 'Свайп вправо', desc: 'Прибавить' },
  { dir: 'left', op: '−', title: 'Свайп влево', desc: 'Вычесть' },
  { dir: 'up', op: '×', title: 'Свайп вверх', desc: 'Умножить' },
  { dir: 'down', op: '÷', title: 'Свайп вниз', desc: 'Разделить' },
  { dir: 'tap', op: '=', title: 'Двойной тап', desc: 'Посчитать результат' },
];

function normalizeInputNumber(value: number): string {
  return toCalculatorInputNumber(value).replace('.', ',');
}

function errorText(error: unknown): string {
  if (error instanceof CalculatorError) return error.message;
  return 'Ошибка';
}

function dirToOp(dx: number, dy: number): Op {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? '+' : '−';
  return dy > 0 ? '÷' : '×';
}

interface Key {
  label: ReactNode;
  tone?: 'util' | 'op' | 'equals' | 'danger';
  aria?: string;
  onClick: () => void;
}

export function CalculatorPage() {
  const history = useFinanceStore((s) => s.calculatorHistory);
  const prefs = useFinanceStore((s) => s.calculatorPrefs);
  const addHistory = useFinanceStore((s) => s.addCalculatorHistory);
  const clearHistory = useFinanceStore((s) => s.clearCalculatorHistory);
  const setPrefs = useFinanceStore((s) => s.setCalculatorPrefs);
  const hydrated = useFinanceStore((s) => s.hydrated);

  const [expression, setExpression] = useState('');
  const [cursor, setCursor] = useState(0);
  const [resultLine, setResultLine] = useState('');
  const [status, setStatus] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [obStep, setObStep] = useState(0);
  const [swipe, setSwipe] = useState<{ active: boolean; dir: Op | null; x: number; y: number }>({
    active: false,
    dir: null,
    x: 0,
    y: 0,
  });
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);

  const calcRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ x: number; y: number; pointerId: number; moved: boolean; onButton: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const lastTapAt = useRef(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydrated && !prefs.onboardingDone) {
      setObStep(0);
      setOnboarding(true);
    }
  }, [hydrated, prefs.onboardingDone]);

  // Keep the tape scrolled to the newest entry (bottom).
  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const preview = useMemo(() => {
    if (!expression.trim()) return '';
    try {
      return evaluateExpression(expression, { ans: prefs.lastAns, angleMode: prefs.angleMode }).formatted;
    } catch {
      return '';
    }
  }, [expression, prefs.angleMode, prefs.lastAns]);

  const safeCursor = Math.max(0, Math.min(expression.length, cursor));
  const before = expression.slice(0, safeCursor);
  const after = expression.slice(safeCursor);

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

  const insertOperation = (op: Op) => {
    const left = expression.slice(0, cursor);
    const right = expression.slice(cursor);
    const needsLeftSpace = left.length > 0 && !/\s$/.test(left);
    const needsRightSpace = right.length > 0 && !/^\s/.test(right);
    const text = `${needsLeftSpace ? ' ' : ''}${op}${needsRightSpace ? ' ' : ' '}`;
    insertText(text);
  };
  const opButton = (op: Op) => {
    insertOperation(op);
    tapMedium();
  };

  const insertFunction = (name: string) => insertText(`${name}()`, name.length + 1);

  const deleteChar = () => {
    if (cursor <= 0) return;
    setFormula(`${expression.slice(0, cursor - 1)}${expression.slice(cursor)}`, cursor - 1);
    tapLight();
  };

  const clearAll = () => {
    setFormula('');
    setResultLine('');
    tapMedium();
  };
  const clearEntry = () => {
    setFormula('');
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
      const result = evaluateExpression(raw, { ans: prefs.lastAns, angleMode: prefs.angleMode });
      addHistory(raw, result.formatted, result.value);
      setFormula(normalizeInputNumber(result.value));
      setResultLine(result.formatted);
      notifySuccess();
    } catch (error) {
      setStatus(errorText(error));
      setResultLine('');
      notifyWarning();
    }
  };

  const currentValue = () => {
    try {
      return evaluateExpression(expression || 'Ans', { ans: prefs.lastAns, angleMode: prefs.angleMode }).value;
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
  const scientific = prefs.scientific ?? false;
  const toggleScientific = () => {
    setPrefs({ scientific: !scientific });
    tapLight();
  };

  // Reuse a past calculation: load its expression to keep editing → a new line.
  const reuse = (expr: string) => {
    setFormula(expr);
    setHistoryOpen(false);
    tapLight();
  };

  const finishOnboarding = () => {
    setOnboarding(false);
    if (!prefs.onboardingDone) setPrefs({ onboardingDone: true });
  };
  const replayOnboarding = () => {
    setSettingsOpen(false);
    setObStep(0);
    setOnboarding(true);
  };

  const playConfirm = (op: Op) => {
    setConfirmOp(op);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmOp(null), 440);
  };

  // ---- swipe gesture across the WHOLE calculator ---------------------------
  const localPoint = (clientX: number, clientY: number) => {
    const rect = calcRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current) return;
    suppressClickRef.current = false;
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      onButton: !!(event.target as HTMLElement).closest('button'),
    };
  };

  // Window-level move/up keep the gesture alive even past the element edges.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || event.pointerId !== g.pointerId) return;
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) g.moved = true;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const dir = dist >= DIR_THRESHOLD ? dirToOp(dx, dy) : null;
      const p = localPoint(event.clientX, event.clientY);
      setSwipe((prev) => {
        if (dir && dir !== prev.dir) selectionChanged();
        return { active: g.moved, dir, x: p.x, y: p.y };
      });
    };
    const onUp = (event: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || event.pointerId !== g.pointerId) return;
      gestureRef.current = null;
      setSwipe({ active: false, dir: null, x: 0, y: 0 });
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD) {
        const op = dirToOp(dx, dy);
        insertOperation(op);
        tapMedium();
        playConfirm(op);
        suppressClickRef.current = true; // cancel the click on whatever we lifted over
        return;
      }
      if (g.onButton || g.moved) return; // button tap → its onClick handles it
      const now = Date.now();
      if (now - lastTapAt.current <= DOUBLE_TAP_MS) {
        lastTapAt.current = 0;
        evaluateCurrent();
      } else {
        lastTapAt.current = now;
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  });

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      event.stopPropagation();
      event.preventDefault();
      suppressClickRef.current = false;
    }
  };

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || onboarding) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
      else if (event.key === '.' || event.key === ',') { event.preventDefault(); insertText(','); }
      else if (event.key === '+') { event.preventDefault(); opButton('+'); }
      else if (event.key === '-') { event.preventDefault(); opButton('−'); }
      else if (event.key === '*') { event.preventDefault(); opButton('×'); }
      else if (event.key === '/') { event.preventDefault(); opButton('÷'); }
      else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); evaluateCurrent(); }
      else if (event.key === 'Backspace') { event.preventDefault(); deleteChar(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); moveCursor(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); moveCursor(1); }
      else if (event.key === '(' || event.key === ')') { event.preventDefault(); insertText(event.key); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Standard calculator keypad (digits + operation column) — swipes work too.
  const pad: Key[] = [
    { label: '%', tone: 'util', aria: 'Процент', onClick: () => insertText('%') },
    { label: 'CE', tone: 'util', aria: 'Очистить ввод', onClick: clearEntry },
    { label: 'C', tone: 'danger', aria: 'Сбросить', onClick: clearAll },
    { label: '⌫', tone: 'util', aria: 'Стереть', onClick: deleteChar },
    { label: '¹⁄ₓ', tone: 'util', aria: 'Обратное число', onClick: () => insertText('^(-1)') },
    { label: 'x²', tone: 'util', aria: 'Квадрат', onClick: () => insertText('^2') },
    { label: '√', tone: 'util', aria: 'Корень', onClick: () => insertFunction('sqrt') },
    { label: '÷', tone: 'op', onClick: () => opButton('÷') },
    { label: '7', onClick: () => insertText('7') },
    { label: '8', onClick: () => insertText('8') },
    { label: '9', onClick: () => insertText('9') },
    { label: '×', tone: 'op', onClick: () => opButton('×') },
    { label: '4', onClick: () => insertText('4') },
    { label: '5', onClick: () => insertText('5') },
    { label: '6', onClick: () => insertText('6') },
    { label: '−', tone: 'op', onClick: () => opButton('−') },
    { label: '1', onClick: () => insertText('1') },
    { label: '2', onClick: () => insertText('2') },
    { label: '3', onClick: () => insertText('3') },
    { label: '+', tone: 'op', onClick: () => opButton('+') },
    { label: '±', tone: 'util', aria: 'Сменить знак', onClick: () => insertText('-') },
    { label: '0', onClick: () => insertText('0') },
    { label: ',', aria: 'Запятая', onClick: () => insertText(',') },
    { label: '=', tone: 'equals', aria: 'Равно', onClick: evaluateCurrent },
  ];

  // Full-size (scientific) rows — revealed by the ƒx toggle.
  const sci: Key[] = [
    { label: prefs.angleMode, tone: 'util', aria: 'Градусы или радианы', onClick: toggleAngleMode },
    { label: 'sin', tone: 'util', onClick: () => insertFunction('sin') },
    { label: 'cos', tone: 'util', onClick: () => insertFunction('cos') },
    { label: 'tan', tone: 'util', onClick: () => insertFunction('tan') },
    { label: 'asin', tone: 'util', onClick: () => insertFunction('asin') },
    { label: 'acos', tone: 'util', onClick: () => insertFunction('acos') },
    { label: 'atan', tone: 'util', onClick: () => insertFunction('atan') },
    { label: 'ln', tone: 'util', onClick: () => insertFunction('ln') },
    { label: 'log', tone: 'util', onClick: () => insertFunction('log') },
    { label: 'π', tone: 'util', onClick: () => insertText('π') },
    { label: 'e', tone: 'util', onClick: () => insertText('e') },
    { label: '^', tone: 'util', aria: 'Степень', onClick: () => insertText('^') },
    { label: '(', tone: 'util', onClick: () => insertText('(') },
    { label: ')', tone: 'util', onClick: () => insertText(')') },
    { label: '!', tone: 'util', aria: 'Факториал', onClick: () => insertText('!') },
    { label: 'Ans', tone: 'util', onClick: () => insertText('Ans') },
    { label: 'MC', tone: 'util', aria: 'Очистить память', onClick: () => memory('clear') },
    { label: 'MR', tone: 'util', aria: 'Вставить память', onClick: () => memory('recall') },
    { label: 'M+', tone: 'util', aria: 'Добавить в память', onClick: () => memory('plus') },
    { label: 'M−', tone: 'util', aria: 'Вычесть из памяти', onClick: () => memory('minus') },
  ];

  return (
    <Screen
      title="Калькулятор"
      subtitle="Свайп — операция, двойной тап — равно"
      action={
        <div className="calc-actions">
          <button
            className={`calc-iconbtn calc-iconbtn--fx${scientific ? ' is-on' : ''}`}
            type="button"
            aria-label="Научный режим"
            aria-pressed={scientific}
            onClick={toggleScientific}
          >
            ƒx
          </button>
          <button className="calc-iconbtn" type="button" aria-label="История" onClick={() => { tapLight(); setHistoryOpen(true); }}>
            <IconClock size={20} />
          </button>
          <button className="calc-iconbtn" type="button" aria-label="Настройки" onClick={() => { tapLight(); setSettingsOpen(true); }}>
            <IconGear size={20} />
          </button>
        </div>
      }
    >
      <div className={`calc${scientific ? ' is-scientific' : ''}`} ref={calcRef} onPointerDown={onPointerDown} onClickCapture={onClickCapture}>
        <div className="calc-screen">
          <div className="calc-tape" ref={tapeRef}>
            {history.slice().reverse().map((item) => (
              <button key={item.id} className="calc-tape__row" type="button" onClick={() => reuse(item.expression)}>
                <span className="calc-tape__expr">{item.expression}</span>
                <span className="calc-tape__res">= {item.result}</span>
              </button>
            ))}
          </div>

          <div className="calc-current">
            <div className={`calc-expr${expression ? '' : ' is-empty'}`}>
              {expression ? (
                <>
                  <span>{before}</span>
                  <span className="calc-cursor" />
                  <span>{after}</span>
                </>
              ) : (
                <>
                  <span>0</span>
                  <span className="calc-cursor" />
                </>
              )}
            </div>
            <div className={`calc-result${status ? ' is-error' : ''}`}>
              {status || (resultLine ? `= ${resultLine}` : preview ? `≈ ${preview}` : '')}
            </div>
          </div>

          {swipe.dir && <div className="calc-bigop">{swipe.dir}</div>}
          {confirmOp && <div className="calc-bigop is-confirm" key={`c${confirmOp}`}>{confirmOp}</div>}
        </div>

        {scientific && (
          <div className="calc-sci">
            {sci.map((k, i) => (
              <button
                key={i}
                type="button"
                aria-label={k.aria}
                className="calc-key calc-key--sci"
                onClick={k.onClick}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}

        <div className="calc-pad">
          {pad.map((k, i) => (
            <button
              key={i}
              type="button"
              aria-label={k.aria}
              className={`calc-key${k.tone ? ` calc-key--${k.tone}` : ''}`}
              onClick={k.onClick}
            >
              {k.label}
            </button>
          ))}
        </div>

        {swipe.active && (
          <div className="calc-compass" style={{ left: swipe.x, top: swipe.y }} aria-hidden="true">
            <span className="calc-compass__ring" />
            <span className={`calc-compass__op is-up${swipe.dir === '×' ? ' is-on' : ''}`}>×</span>
            <span className={`calc-compass__op is-right${swipe.dir === '+' ? ' is-on' : ''}`}>+</span>
            <span className={`calc-compass__op is-down${swipe.dir === '÷' ? ' is-on' : ''}`}>÷</span>
            <span className={`calc-compass__op is-left${swipe.dir === '−' ? ' is-on' : ''}`}>−</span>
          </div>
        )}
      </div>

      {historyOpen && (
        <>
          <div className="calc-scrim" onClick={() => setHistoryOpen(false)} />
          <div className="calc-history-panel" role="dialog" aria-label="История">
            <div className="calc-history-panel__head">
              <b>История</b>
              <div className="row" style={{ gap: 8 }}>
                {history.length > 0 && (
                  <button className="calc-textbtn" type="button" onClick={() => { clearHistory(); tapMedium(); }}>Очистить</button>
                )}
                <button className="calc-textbtn" type="button" onClick={() => setHistoryOpen(false)}>Закрыть</button>
              </div>
            </div>
            {history.length ? (
              <div className="calc-history-panel__list">
                {history.map((item) => (
                  <button key={item.id} className="calc-history-item" type="button" onClick={() => reuse(item.expression)}>
                    <span>{item.expression}</span>
                    <b>= {item.result}</b>
                  </button>
                ))}
              </div>
            ) : (
              <div className="calc-history-empty">Пока пусто — первые вычисления появятся здесь.</div>
            )}
          </div>
        </>
      )}

      {settingsOpen && (
        <Sheet title="Калькулятор" onClose={() => setSettingsOpen(false)}>
          <div className="stack">
            <div className="calc-seg">
              <button className={`calc-seg__opt${prefs.angleMode === 'DEG' ? ' is-active' : ''}`} type="button" onClick={() => prefs.angleMode !== 'DEG' && toggleAngleMode()}>Градусы</button>
              <button className={`calc-seg__opt${prefs.angleMode === 'RAD' ? ' is-active' : ''}`} type="button" onClick={() => prefs.angleMode !== 'RAD' && toggleAngleMode()}>Радианы</button>
            </div>

            <button className="btn btn--block" type="button" onClick={() => { toggleScientific(); setSettingsOpen(false); }}>
              {scientific ? 'Скрыть научные функции' : 'Показать научные функции (ƒx)'}
            </button>
            <button className="btn btn--block" type="button" onClick={replayOnboarding}>Показать обучение ещё раз</button>
            {history.length > 0 && (
              <button className="btn btn--block btn--danger" type="button" onClick={() => { clearHistory(); tapMedium(); setSettingsOpen(false); }}>
                Очистить историю
              </button>
            )}
          </div>
        </Sheet>
      )}

      {onboarding && (
        <OnboardingOverlay
          step={obStep}
          onPrev={() => setObStep((s) => Math.max(0, s - 1))}
          onNext={() => { if (obStep >= STEPS.length - 1) finishOnboarding(); else setObStep((s) => s + 1); }}
          onSkip={finishOnboarding}
        />
      )}
    </Screen>
  );
}

function OnboardingOverlay({
  step,
  onPrev,
  onNext,
  onSkip,
}: {
  step: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="calc-ob">
      <div className="calc-ob__card" key={step}>
        <button className="calc-ob__skip" type="button" onClick={onSkip}>Пропустить</button>

        <div className={`calc-ob__stage calc-ob__stage--${s.dir}`}>
          <span className="calc-ob__trail" />
          <span className="calc-ob__finger">👆</span>
          <span className="calc-ob__op">{s.op}</span>
        </div>

        <div className="calc-ob__title">{s.title}</div>
        <div className="calc-ob__desc">{s.desc}</div>

        <div className="calc-ob__dots">
          {STEPS.map((item, i) => (
            <span key={item.title} className={`calc-ob__dot${i === step ? ' is-on' : ''}`} />
          ))}
        </div>

        <div className="calc-ob__actions">
          {step > 0 ? <button className="btn btn--ghost" type="button" onClick={onPrev}>Назад</button> : <span />}
          <button className="btn btn--primary" type="button" onClick={onNext}>{last ? 'Начать' : 'Далее'}</button>
        </div>
      </div>
    </div>
  );
}
