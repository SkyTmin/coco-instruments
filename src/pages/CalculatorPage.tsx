import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Screen, Sheet } from '@/components/ui';
import { IconClock, IconGear } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CalculatorError, evaluateExpression, formatCalculatorNumber, toCalculatorInputNumber } from '@/lib/calculator';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

type Op = '+' | '−' | '×' | '÷';

const SWIPE_THRESHOLD = 36;
const DIR_THRESHOLD = 12;
const DOUBLE_TAP_MS = 300;

/** Gesture onboarding steps, shown once on first open. */
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

/** Dominant-axis direction → operator. right=+, left=−, up=×, down=÷. */
function dirToOp(dx: number, dy: number): Op {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? '+' : '−';
  return dy > 0 ? '÷' : '×';
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
  // Live swipe state for the center symbol + compass ring.
  const [swipe, setSwipe] = useState<{ active: boolean; dir: Op | null; x: number; y: number }>({
    active: false,
    dir: null,
    x: 0,
    y: 0,
  });
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);

  const screenRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; pointerId: number; moved: boolean } | null>(null);
  const lastTapAt = useRef(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First-run onboarding (once hydrated so we read the persisted flag).
  useEffect(() => {
    if (hydrated && !prefs.onboardingDone) {
      setObStep(0);
      setOnboarding(true);
    }
  }, [hydrated, prefs.onboardingDone]);

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

  const insertFunction = (name: string) => insertText(`${name}()`, name.length + 1);

  const deleteChar = () => {
    if (cursor <= 0) return;
    setFormula(`${expression.slice(0, cursor - 1)}${expression.slice(cursor)}`, cursor - 1);
    tapLight();
  };

  const clear = () => {
    setFormula('');
    setResultLine('');
    tapMedium();
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

  const loadHistory = (expr: string, result: string) => {
    setFormula(expr);
    setResultLine(result);
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

  // ---- swipe gesture on the display surface --------------------------------
  const localPoint = (clientX: number, clientY: number) => {
    const rect = screenRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false };
    const p = localPoint(event.clientX, event.clientY);
    setSwipe({ active: true, dir: null, x: p.x, y: p.y });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) start.moved = true;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const dir = dist >= DIR_THRESHOLD ? dirToOp(dx, dy) : null;
    const p = localPoint(event.clientX, event.clientY);
    setSwipe((prev) => {
      if (dir && dir !== prev.dir) selectionChanged();
      return { active: true, dir, x: p.x, y: p.y };
    });
    if (dist > SWIPE_THRESHOLD) event.preventDefault();
  };

  const playConfirm = (op: Op) => {
    setConfirmOp(op);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmOp(null), 440);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    gesture.current = null;
    setSwipe({ active: false, dir: null, x: 0, y: 0 });
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD) {
      const op = dirToOp(dx, dy);
      insertOperation(op);
      tapMedium();
      playConfirm(op);
      return;
    }
    if (start.moved) return;
    const now = Date.now();
    if (now - lastTapAt.current <= DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      evaluateCurrent();
    } else {
      lastTapAt.current = now;
    }
  };

  const onPointerCancel = () => {
    gesture.current = null;
    setSwipe({ active: false, dir: null, x: 0, y: 0 });
  };

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  // Physical keyboard (desktop).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || onboarding) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
      else if (event.key === '.' || event.key === ',') { event.preventDefault(); insertText(','); }
      else if (event.key === '+') { event.preventDefault(); insertOperation('+'); }
      else if (event.key === '-') { event.preventDefault(); insertOperation('−'); }
      else if (event.key === '*') { event.preventDefault(); insertOperation('×'); }
      else if (event.key === '/') { event.preventDefault(); insertOperation('÷'); }
      else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); evaluateCurrent(); }
      else if (event.key === 'Backspace') { event.preventDefault(); deleteChar(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); moveCursor(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); moveCursor(1); }
      else if (event.key === '(' || event.key === ')') { event.preventDefault(); insertText(event.key); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];
  const resultDisplay = status || resultLine || (preview ? `≈ ${preview}` : formatCalculatorNumber(prefs.lastAns));

  return (
    <Screen
      title="Калькулятор"
      subtitle="Свайп — операция, двойной тап — равно"
      action={
        <div className="calc-actions">
          <button className="calc-iconbtn" type="button" aria-label="История" onClick={() => { tapLight(); setHistoryOpen(true); }}>
            <IconClock size={20} />
          </button>
          <button className="calc-iconbtn" type="button" aria-label="Настройки" onClick={() => { tapLight(); setSettingsOpen(true); }}>
            <IconGear size={20} />
          </button>
        </div>
      }
    >
      <div className="calc">
        <div
          className="calc-screen"
          ref={screenRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {history.length > 0 && (
            <div className="calc-screen__history">
              {history.slice(0, 3).reverse().map((item) => (
                <button key={item.id} className="calc-peek" type="button" onClick={() => loadHistory(item.expression, item.result)}>
                  <span>{item.expression}</span>
                  <b>= {item.result}</b>
                </button>
              ))}
            </div>
          )}

          <div className="calc-screen__main">
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
            <div className={`calc-result${status ? ' is-error' : ''}`}>{resultDisplay}</div>
          </div>

          {/* Big centred operation symbol while swiping */}
          {swipe.dir && <div className="calc-bigop">{swipe.dir}</div>}
          {confirmOp && <div className="calc-bigop is-confirm" key={`c${confirmOp}`}>{confirmOp}</div>}

          {/* Compass ring around the finger */}
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

        <div className="calc-pad">
          <button className="calc-key calc-key--util calc-key--danger" type="button" onClick={clear}>AC</button>
          <button className="calc-key calc-key--util" type="button" onClick={() => insertText('(')}>(</button>
          <button className="calc-key calc-key--util" type="button" onClick={() => insertText(')')}>)</button>
          <button className="calc-key calc-key--util" type="button" aria-label="Удалить" onClick={deleteChar}>⌫</button>

          {digits.slice(0, 3).map((d) => <button key={d} className="calc-key" type="button" onClick={() => insertText(d)}>{d}</button>)}
          <button className="calc-key calc-key--util" type="button" aria-label="Курсор влево" onClick={() => moveCursor(-1)}>‹</button>

          {digits.slice(3, 6).map((d) => <button key={d} className="calc-key" type="button" onClick={() => insertText(d)}>{d}</button>)}
          <button className="calc-key calc-key--util" type="button" aria-label="Курсор вправо" onClick={() => moveCursor(1)}>›</button>

          {digits.slice(6, 9).map((d) => <button key={d} className="calc-key" type="button" onClick={() => insertText(d)}>{d}</button>)}
          <button className="calc-key calc-key--util" type="button" onClick={() => insertText('Ans')}>Ans</button>

          <button className="calc-key" type="button" onClick={() => insertText('0')}>0</button>
          <button className="calc-key" type="button" aria-label="Запятая" onClick={() => insertText(',')}>,</button>
          <button className="calc-key calc-key--equals" type="button" aria-label="Равно" onClick={evaluateCurrent} style={{ gridColumn: 'span 2' }}>=</button>
        </div>
      </div>

      {/* History — slides down from the top */}
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
                  <button key={item.id} className="calc-history-item" type="button" onClick={() => loadHistory(item.expression, item.result)}>
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

      {/* Settings + scientific functions */}
      {settingsOpen && (
        <Sheet title="Калькулятор" onClose={() => setSettingsOpen(false)}>
          <div className="stack">
            <div className="calc-seg">
              <button className={`calc-seg__opt${prefs.angleMode === 'DEG' ? ' is-active' : ''}`} type="button" onClick={() => prefs.angleMode !== 'DEG' && toggleAngleMode()}>Градусы</button>
              <button className={`calc-seg__opt${prefs.angleMode === 'RAD' ? ' is-active' : ''}`} type="button" onClick={() => prefs.angleMode !== 'RAD' && toggleAngleMode()}>Радианы</button>
            </div>

            <div className="section-label" style={{ margin: '4px 2px 0' }}>Научные функции</div>
            <div className="calc-sci-grid">
              {['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log'].map((fn) => (
                <button key={fn} className="calc-key calc-key--sci" type="button" onClick={() => { insertFunction(fn); setSettingsOpen(false); }}>{fn}</button>
              ))}
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertFunction('sqrt'); setSettingsOpen(false); }}>√</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('^2'); setSettingsOpen(false); }}>x²</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('^'); setSettingsOpen(false); }}>xʸ</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('!'); setSettingsOpen(false); }}>n!</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('%'); setSettingsOpen(false); }}>%</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('π'); setSettingsOpen(false); }}>π</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertText('e'); setSettingsOpen(false); }}>e</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { insertFunction('abs'); setSettingsOpen(false); }}>|x|</button>
            </div>

            <div className="section-label" style={{ margin: '4px 2px 0' }}>Память</div>
            <div className="calc-mem-grid">
              <button className="calc-key calc-key--sci" type="button" onClick={() => memory('clear')}>MC</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => { memory('recall'); setSettingsOpen(false); }}>MR</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => memory('plus')}>M+</button>
              <button className="calc-key calc-key--sci" type="button" onClick={() => memory('minus')}>M−</button>
            </div>

            <button className="btn btn--block" type="button" onClick={replayOnboarding}>Показать обучение ещё раз</button>
          </div>
        </Sheet>
      )}

      {/* First-run gesture onboarding */}
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
          {step > 0 ? (
            <button className="btn btn--ghost" type="button" onClick={onPrev}>Назад</button>
          ) : (
            <span />
          )}
          <button className="btn btn--primary" type="button" onClick={onNext}>
            {last ? 'Начать' : 'Далее'}
          </button>
        </div>
      </div>
    </div>
  );
}
