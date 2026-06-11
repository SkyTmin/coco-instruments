import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { ShapeDiagram } from '@/components/ShapeDiagram';
import { shapesByCategory, type ShapeCategory } from '@/lib/geometry';
import { tapLight } from '@/lib/haptics';

export function FormulasPage() {
  const navigate = useNavigate();
  const [cat, setCat] = useState<ShapeCategory>('2d');
  const shapes = shapesByCategory(cat);

  return (
    <Screen title="Формулы" subtitle="Калькуляторы по геометрическим фигурам">
      <div className="calc-seg" style={{ marginBottom: 16 }}>
        <button
          className={`calc-seg__opt${cat === '2d' ? ' is-active' : ''}`}
          type="button"
          onClick={() => {
            setCat('2d');
            tapLight();
          }}
        >
          2D формы
        </button>
        <button
          className={`calc-seg__opt${cat === '3d' ? ' is-active' : ''}`}
          type="button"
          onClick={() => {
            setCat('3d');
            tapLight();
          }}
        >
          3D-фигуры
        </button>
      </div>

      {/* key={cat} remounts the grid so the 2D/3D toggle replays the cascade */}
      <div className="formula-grid" key={cat}>
        {shapes.map((s, index) => (
          <button
            key={s.id}
            className="formula-card"
            type="button"
            style={{ animationDelay: `${Math.min(index, 11) * 22}ms` }}
            onClick={() => {
              tapLight();
              navigate(`/calculator/formulas/${s.id}`);
            }}
          >
            <span className="formula-card__viz">
              <ShapeDiagram id={s.id} />
            </span>
            <span className="formula-card__name">{s.name}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
