import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Sheet } from '@/components/ui';
import { IconClock, IconGear, IconShapes } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CalculatorError, evaluateExpression, toCalculatorInputNumber } from '@/lib/calculator';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

type Op = '+' | '−' | '×' | '÷';

const SWIPE_THRESHOLD = 36;
const DIR_THRESHOLD = 14;
const MOVE_TOLERANCE = 7;

const STEPS: {
  dir: 'right' | 'left' | 'up' | 'down' | 'tap';
  op: Op | '=';
  title: string;
  desc: string;
}[] = [
  { dir: 'right', op: '+', title: 'Свайп вправо', desc: 'Прибавить' },
  { dir: 'left', op: '−', title: 'Свайп влево', desc: 'Вычесть' },
  { dir: 'up', op: '×', title: 'Свайп вверх', desc: 'Умножить' },
  { dir: 'down', op: '÷', title: 'Свайп вниз', desc: 'Разделить' },
  { dir: 'tap', op: '=', title: 'Кнопка «=»', desc: 'Посчитать результат' },
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

// Bounds of the line the caret sits on inside the multi-line tape.
function lineRange(text: string, caret: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', caret);
  return { start, end: nl === -1 ? text.length : nl };
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
  const navigate = useNavigate();

  // The whole display is one editable tape (multi-line). `caret` mirrors the
  // textarea selection so we can preview the active line and insert in place.
  const [doc, setDoc] = useState('');
  const [caret, setCaret] = useState(0);
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Caret to restore after a programmatic edit (null → leave native caret alone).
  const pendingCaret = useRef<number | null>(null);
  const gestureRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
    moved: boolean;
    onButton: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydrated && !prefs.onboardingDone) {
      setObStep(0);
      setOnboarding(true);
    }
  }, [hydrated, prefs.onboardingDone]);

  // After a programmatic edit, put the native caret back where we want it (and
  // keep it in view). Native typing leaves pendingCaret null → untouched.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || pendingCaret.current == null) return;
    const pos = Math.max(0, Math.min(doc.length, pendingCaret.current));
    pendingCaret.current = null;
    if (!onboarding) el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
    if (pos >= doc.length) el.scrollTop = el.scrollHeight;
  }, [doc, onboarding]);

  // Give the tape focus once ready so a hardware keyboard works right away.
  useEffect(() => {
    if (hydrated && !onboarding) inputRef.current?.focus({ preventScroll: true });
  }, [hydrated, onboarding]);

  const activeLine = useMemo(() => {
    const { start, end } = lineRange(doc, Math.min(caret, doc.length));
    return doc.slice(start, end).trim();
  }, [doc, caret]);

  const preview = useMemo(() => {
    if (!activeLine) return '';
    try {
      return evaluateExpression(activeLine, { ans: prefs.lastAns, angleMode: prefs.angleMode })
        .formatted;
    } catch {
      return '';
    }
  }, [activeLine, prefs.angleMode, prefs.lastAns]);

  // Single entry point for every programmatic change to the tape.
  const commit = (next: string, nextCaret: number) => {
    pendingCaret.current = Math.max(0, Math.min(next.length, nextCaret));
    setCaret(pendingCaret.current);
    setDoc(next);
    setStatus('');
  };

  const selection = () => {
    const el = inputRef.current;
    if (!el) return { start: doc.length, end: doc.length };
    return { start: el.selectionStart ?? doc.length, end: el.selectionEnd ?? doc.length };
  };

  const insertText = (text: string, offset = text.length) => {
    const { start, end } = selection();
    commit(`${doc.slice(0, start)}${text}${doc.slice(end)}`, start + offset);
    selectionChanged();
  };

  const insertFunction = (name: string) => insertText(`${name}()`, name.length + 1);

  // Insert an operator on the current line — if one already sits right before the
  // caret, swap it (so "5 +" then "−" becomes "5 −"); with no left operand, chain
  // from the previous answer (Ans).
  const insertOperation = (op: Op) => {
    const { start } = selection();
    const { start: lineStart } = lineRange(doc, start);
    const lineLeft = doc.slice(lineStart, start).replace(/[ \t]+$/, '');
    const rest = doc.slice(start);
    const base = /[-+−×÷*/^]$/.test(lineLeft)
      ? lineLeft.slice(0, -1).replace(/[ \t]+$/, '')
      : lineLeft;
    const head = base.trim() === '' ? `Ans ${op} ` : `${base} ${op} `;
    commit(`${doc.slice(0, lineStart)}${head}${rest}`, lineStart + head.length);
    selectionChanged();
  };
  const opButton = (op: Op) => {
    insertOperation(op);
    tapMedium();
  };

  const deleteChar = () => {
    const { start, end } = selection();
    if (start !== end) {
      commit(`${doc.slice(0, start)}${doc.slice(end)}`, start);
    } else {
      if (start <= 0) return;
      commit(`${doc.slice(0, start - 1)}${doc.slice(start)}`, start - 1);
    }
    tapLight();
  };

  // CE — clear just the current line. C — clear the whole tape. Neither touches
  // the saved history: it always stays under the «История» button.
  const clearEntry = () => {
    const { start } = selection();
    const { start: lineStart, end: lineEnd } = lineRange(doc, start);
    commit(`${doc.slice(0, lineStart)}${doc.slice(lineEnd)}`, lineStart);
    tapLight();
  };
  const clearAll = () => {
    commit('', 0);
    tapMedium();
  };

  // Evaluate the line the caret is on, then drop the result on a brand-new line at
  // the very bottom — every earlier line stays exactly where it is and editable.
  const evaluateCurrent = () => {
    const { start } = selection();
    const { start: lineStart, end: lineEnd } = lineRange(doc, start);
    const lineText = doc.slice(lineStart, lineEnd).trim();
    if (!lineText) return;
    try {
      const result = evaluateExpression(lineText, {
        ans: prefs.lastAns,
        angleMode: prefs.angleMode,
      });
      addHistory(lineText, result.formatted, result.value);
      const body = doc.replace(/\s+$/u, '');
      const next = `${body}\n${normalizeInputNumber(result.value)}\n`;
      commit(next, next.length);
      notifySuccess();
    } catch (error) {
      setStatus(errorText(error));
      notifyWarning();
    }
  };

  const currentValue = () => {
    try {
      return evaluateExpression(activeLine || 'Ans', {
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
  const scientific = prefs.scientific ?? false;
  const toggleScientific = () => {
    setPrefs({ scientific: !scientific });
    tapLight();
  };

  // Reuse a past calculation: drop its expression in at the caret to keep editing.
  const reuse = (expr: string) => {
    insertText(expr);
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

  // ---- tape editing keys ---------------------------------------------------
  const onDocChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDoc(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    setStatus('');
  };
  const syncCaret = (event: { currentTarget: HTMLTextAreaElement }) => {
    setCaret(event.currentTarget.selectionStart ?? 0);
  };
  const onDocKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      evaluateCurrent();
    } else if (event.key === '=') {
      event.preventDefault();
      evaluateCurrent();
    } else if (event.key === '*') {
      event.preventDefault();
      insertText('×');
    } else if (event.key === '/') {
      event.preventDefault();
      insertText('÷');
    } else if (event.key === '.') {
      event.preventDefault();
      insertText(',');
    }
    // digits, +, -, comma, parens, arrows, Backspace … all stay native.
  };

  // ---- swipe gesture across the keypad (the tape stays a normal editor) -----
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
      }
      // A plain tap falls through to native handling: the tape places its caret
      // (tap to position the cursor), a key fires its onClick.
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

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  // Standard calculator keypad (digits + operation column) — swipes work too.
  const pad: Key[] = [
    { label: '%', tone: 'util', aria: 'Процент', onClick: () => insertText('%') },
    { label: 'CE', tone: 'util', aria: 'Очистить строку', onClick: clearEntry },
    { label: 'C', tone: 'danger', aria: 'Очистить всё', onClick: clearAll },
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
      subtitle="Свайп — операция · тап — курсор"
      className={scientific ? undefined : 'screen--fit'}
      action={
        <div className="calc-actions">
          <button
            className="calc-iconbtn"
            type="button"
            aria-label="Формулы фигур"
            onClick={() => {
              tapLight();
              navigate('/calculator/formulas');
            }}
          >
            <IconShapes size={20} />
          </button>
          <button
            className={`calc-iconbtn calc-iconbtn--fx${scientific ? ' is-on' : ''}`}
            type="button"
            aria-label="Научный режим"
            aria-pressed={scientific}
            onClick={toggleScientific}
          >
            ƒx
          </button>
          <button
            className="calc-iconbtn"
            type="button"
            aria-label="История"
            onClick={() => {
              tapLight();
              setHistoryOpen(true);
            }}
          >
            <IconClock size={20} />
          </button>
          <button
            className="calc-iconbtn"
            type="button"
            aria-label="Настройки"
            onClick={() => {
              tapLight();
              setSettingsOpen(true);
            }}
          >
            <IconGear size={20} />
          </button>
        </div>
      }
    >
      <div
        className={`calc${scientific ? ' is-scientific' : ''}`}
        ref={calcRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      >
        <div className="calc-screen">
          <textarea
            ref={inputRef}
            className="calc-input"
            value={doc}
            onChange={onDocChange}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onKeyDown={onDocKeyDown}
            inputMode="none"
            placeholder="0"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Лента вычислений"
          />
          {(status || preview) && (
            <div className={`calc-preview${status ? ' is-error' : ''}`}>
              {status || (preview ? `= ${preview}` : '')}
            </div>
          )}

          {swipe.dir && <div className="calc-bigop">{swipe.dir}</div>}
          {confirmOp && (
            <div className="calc-bigop is-confirm" key={`c${confirmOp}`}>
              {confirmOp}
            </div>
          )}
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
            <span className={`calc-compass__op is-right${swipe.dir === '+' ? ' is-on' : ''}`}>
              +
            </span>
            <span className={`calc-compass__op is-down${swipe.dir === '÷' ? ' is-on' : ''}`}>
              ÷
            </span>
            <span className={`calc-compass__op is-left${swipe.dir === '−' ? ' is-on' : ''}`}>
              −
            </span>
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
                  <button
                    className="calc-textbtn"
                    type="button"
                    onClick={() => {
                      clearHistory();
                      tapMedium();
                    }}
                  >
                    Очистить
                  </button>
                )}
                <button
                  className="calc-textbtn"
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                >
                  Закрыть
                </button>
              </div>
            </div>
            {history.length ? (
              <div className="calc-history-panel__list">
                {history.map((item) => (
                  <button
                    key={item.id}
                    className="calc-history-item"
                    type="button"
                    onClick={() => reuse(item.expression)}
                  >
                    <span>{item.expression}</span>
                    <b>= {item.result}</b>
                  </button>
                ))}
              </div>
            ) : (
              <div className="calc-history-empty">
                Пока пусто — первые вычисления появятся здесь.
              </div>
            )}
          </div>
        </>
      )}

      {settingsOpen && (
        <Sheet title="Калькулятор" onClose={() => setSettingsOpen(false)}>
          <div className="stack">
            <div className="calc-seg">
              <button
                className={`calc-seg__opt${prefs.angleMode === 'DEG' ? ' is-active' : ''}`}
                type="button"
                onClick={() => prefs.angleMode !== 'DEG' && toggleAngleMode()}
              >
                Градусы
              </button>
              <button
                className={`calc-seg__opt${prefs.angleMode === 'RAD' ? ' is-active' : ''}`}
                type="button"
                onClick={() => prefs.angleMode !== 'RAD' && toggleAngleMode()}
              >
                Радианы
              </button>
            </div>

            <button
              className="btn btn--block"
              type="button"
              onClick={() => {
                toggleScientific();
                setSettingsOpen(false);
              }}
            >
              {scientific ? 'Скрыть научные функции' : 'Показать научные функции (ƒx)'}
            </button>
            <button className="btn btn--block" type="button" onClick={replayOnboarding}>
              Показать обучение ещё раз
            </button>
            {history.length > 0 && (
              <button
                className="btn btn--block btn--danger"
                type="button"
                onClick={() => {
                  clearHistory();
                  tapMedium();
                  setSettingsOpen(false);
                }}
              >
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
          onNext={() => {
            if (obStep >= STEPS.length - 1) finishOnboarding();
            else setObStep((s) => s + 1);
          }}
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
        <button className="calc-ob__skip" type="button" onClick={onSkip}>
          Пропустить
        </button>

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
            <button className="btn btn--ghost" type="button" onClick={onPrev}>
              Назад
            </button>
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
