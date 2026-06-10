import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { ShapeDiagram } from '@/components/ShapeDiagram';
import { dimSuffix, getShape } from '@/lib/geometry';
import { formatCalculatorNumber } from '@/lib/calculator';

function parseNum(raw: string): number | null {
  const t = raw.trim().replace(',', '.').replace(/\s/g, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function FormulaDetailPage() {
  const { id } = useParams();
  const shape = id ? getShape(id) : undefined;
  const [vals, setVals] = useState<Record<string, string>>({});

  if (!shape) {
    return (
      <Screen title="Формула">
        <div className="formula-hint" style={{ padding: 12 }}>
          Фигура не найдена.
        </div>
      </Screen>
    );
  }

  const nums: Record<string, number> = {};
  let filled = 0;
  for (const v of shape.vars) {
    const n = parseNum(vals[v.key] ?? '');
    if (n !== null) {
      nums[v.key] = n;
      filled += 1;
    }
  }
  const allFilled = filled === shape.vars.length;
  const error = allFilled && shape.validate ? shape.validate(nums) : null;
  const ready = allFilled && !error;

  return (
    <Screen title={shape.name} subtitle={shape.blurb}>
      <div className="formula-diagram">
        <ShapeDiagram id={shape.id} />
      </div>

      <h3 className="formula-h">Введите значения</h3>
      <div className="formula-inputs">
        {shape.vars.map((v) => (
          <div className="field" key={v.key} style={{ marginBottom: 0 }}>
            <label className="field__label">{v.label}</label>
            <input
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={vals[v.key] ?? ''}
              onChange={(e) => setVals((p) => ({ ...p, [v.key]: e.target.value }))}
            />
            <p className="formula-hint">{v.hint}</p>
          </div>
        ))}
      </div>

      {error && <div className="formula-error">{error}</div>}

      <h3 className="formula-h">Результаты</h3>
      <div className="formula-results">
        {shape.results.map((r) => {
          let display = '—';
          if (ready) {
            const value = r.compute(nums);
            display = Number.isFinite(value)
              ? `${formatCalculatorNumber(value)}${dimSuffix(r.dim)}`
              : '—';
          }
          return (
            <div className="formula-result" key={r.key}>
              <div className="formula-result__top">
                <span className="formula-result__label">{r.label}</span>
                <span className="formula-result__val">{display}</span>
              </div>
              <code className="formula-result__formula">{r.formula}</code>
              <p className="formula-hint">{r.hint}</p>
            </div>
          );
        })}
      </div>

      <p className="formula-note">
        Результаты — в тех же единицах, что и ввод: длина «ед», площадь «ед²», объём «ед³».
      </p>
    </Screen>
  );
}
