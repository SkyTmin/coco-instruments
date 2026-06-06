// Geometry reference + calculators: data for the "Формулы" section.
// Each shape declares its input variables (with a plain-language hint of where
// to take the value) and its results (with the formula shown and a hint of what
// it computes). The detail page renders inputs, validates, and computes live.

export type ShapeCategory = '2d' | '3d';
export type Dim = 'length' | 'area' | 'volume' | 'angle' | 'number';

export interface ShapeVar {
  key: string;
  label: string;
  hint: string;
}

export interface ShapeResult {
  key: string;
  label: string;
  formula: string;
  hint: string;
  dim: Dim;
  compute: (v: Record<string, number>) => number;
}

export interface ShapeDef {
  id: string;
  name: string;
  category: ShapeCategory;
  blurb: string;
  vars: ShapeVar[];
  results: ShapeResult[];
  /** Return an error message when the inputs are geometrically impossible. */
  validate?: (v: Record<string, number>) => string | null;
}

const PI = Math.PI;
const rad = (deg: number) => (deg * PI) / 180;

const SHAPES_2D: ShapeDef[] = [
  {
    id: 'square',
    name: 'Квадрат',
    category: '2d',
    blurb: 'Четыре равные стороны и прямые углы.',
    vars: [{ key: 'a', label: 'Сторона a', hint: 'Длина стороны квадрата.' }],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = a²', hint: 'Сторона в квадрате.', dim: 'area', compute: (v) => v.a ** 2 },
      { key: 'P', label: 'Периметр', formula: 'P = 4·a', hint: 'Сумма всех четырёх сторон.', dim: 'length', compute: (v) => 4 * v.a },
      { key: 'd', label: 'Диагональ', formula: 'd = a·√2', hint: 'Линия между противоположными углами.', dim: 'length', compute: (v) => v.a * Math.SQRT2 },
    ],
  },
  {
    id: 'rectangle',
    name: 'Прямоугольник',
    category: '2d',
    blurb: 'Противоположные стороны равны, все углы прямые.',
    vars: [
      { key: 'a', label: 'Сторона a (длина)', hint: 'Одна из сторон.' },
      { key: 'b', label: 'Сторона b (ширина)', hint: 'Смежная сторона.' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = a·b', hint: 'Произведение сторон.', dim: 'area', compute: (v) => v.a * v.b },
      { key: 'P', label: 'Периметр', formula: 'P = 2·(a + b)', hint: 'Сумма всех сторон.', dim: 'length', compute: (v) => 2 * (v.a + v.b) },
      { key: 'd', label: 'Диагональ', formula: 'd = √(a² + b²)', hint: 'По теореме Пифагора.', dim: 'length', compute: (v) => Math.hypot(v.a, v.b) },
    ],
  },
  {
    id: 'triangle',
    name: 'Треугольник',
    category: '2d',
    blurb: 'Произвольный треугольник по трём сторонам (формула Герона).',
    vars: [
      { key: 'a', label: 'Сторона a', hint: 'Длина первой стороны.' },
      { key: 'b', label: 'Сторона b', hint: 'Длина второй стороны.' },
      { key: 'c', label: 'Сторона c', hint: 'Длина третьей стороны.' },
    ],
    validate: (v) =>
      v.a + v.b > v.c && v.a + v.c > v.b && v.b + v.c > v.a ? null : 'Такие стороны не образуют треугольник.',
    results: [
      { key: 'P', label: 'Периметр', formula: 'P = a + b + c', hint: 'Сумма сторон.', dim: 'length', compute: (v) => v.a + v.b + v.c },
      {
        key: 'A',
        label: 'Площадь',
        formula: 'A = √(s·(s−a)(s−b)(s−c)), s = (a+b+c)/2',
        hint: 'Формула Герона; s — полупериметр.',
        dim: 'area',
        compute: (v) => {
          const s = (v.a + v.b + v.c) / 2;
          return Math.sqrt(s * (s - v.a) * (s - v.b) * (s - v.c));
        },
      },
      {
        key: 'ha',
        label: 'Высота к стороне a',
        formula: 'hₐ = 2·A / a',
        hint: 'Перпендикуляр из вершины на сторону a.',
        dim: 'length',
        compute: (v) => {
          const s = (v.a + v.b + v.c) / 2;
          const A = Math.sqrt(s * (s - v.a) * (s - v.b) * (s - v.c));
          return (2 * A) / v.a;
        },
      },
    ],
  },
  {
    id: 'isosceles',
    name: 'Равнобедренный треугольник',
    category: '2d',
    blurb: 'Две боковые стороны равны.',
    vars: [
      { key: 'a', label: 'Боковая сторона a', hint: 'Одна из двух равных сторон.' },
      { key: 'b', label: 'Основание b', hint: 'Сторона между равными сторонами.' },
    ],
    validate: (v) => (2 * v.a > v.b ? null : 'Боковые стороны слишком малы для такого основания.'),
    results: [
      { key: 'P', label: 'Периметр', formula: 'P = 2·a + b', hint: 'Сумма сторон.', dim: 'length', compute: (v) => 2 * v.a + v.b },
      { key: 'h', label: 'Высота', formula: 'h = √(a² − (b/2)²)', hint: 'Высота к основанию b.', dim: 'length', compute: (v) => Math.sqrt(v.a ** 2 - (v.b / 2) ** 2) },
      { key: 'A', label: 'Площадь', formula: 'A = (b/4)·√(4·a² − b²)', hint: 'Половина основания на высоту.', dim: 'area', compute: (v) => (v.b / 4) * Math.sqrt(4 * v.a ** 2 - v.b ** 2) },
    ],
  },
  {
    id: 'equilateral',
    name: 'Равносторонний треугольник',
    category: '2d',
    blurb: 'Все три стороны и угла равны (углы по 60°).',
    vars: [{ key: 'a', label: 'Сторона a', hint: 'Длина любой стороны.' }],
    results: [
      { key: 'P', label: 'Периметр', formula: 'P = 3·a', hint: 'Сумма сторон.', dim: 'length', compute: (v) => 3 * v.a },
      { key: 'h', label: 'Высота', formula: 'h = (√3/2)·a', hint: 'Высота к любой стороне.', dim: 'length', compute: (v) => (Math.sqrt(3) / 2) * v.a },
      { key: 'A', label: 'Площадь', formula: 'A = (√3/4)·a²', hint: 'Площадь через сторону.', dim: 'area', compute: (v) => (Math.sqrt(3) / 4) * v.a ** 2 },
    ],
  },
  {
    id: 'parallelogram',
    name: 'Параллелограмм',
    category: '2d',
    blurb: 'Противоположные стороны параллельны и равны.',
    vars: [
      { key: 'a', label: 'Сторона a', hint: 'Боковая сторона.' },
      { key: 'b', label: 'Сторона b (основание)', hint: 'Сторона, на которую опускается высота.' },
      { key: 'th', label: 'Угол θ (°)', hint: 'Угол между сторонами a и b, в градусах.' },
    ],
    validate: (v) => (v.th > 0 && v.th < 180 ? null : 'Угол должен быть от 0 до 180°.'),
    results: [
      { key: 'P', label: 'Периметр', formula: 'P = 2·(a + b)', hint: 'Сумма сторон.', dim: 'length', compute: (v) => 2 * (v.a + v.b) },
      { key: 'h', label: 'Высота', formula: 'h = a·sin θ', hint: 'Высота к основанию b.', dim: 'length', compute: (v) => v.a * Math.sin(rad(v.th)) },
      { key: 'A', label: 'Площадь', formula: 'A = a·b·sin θ', hint: 'Основание на высоту.', dim: 'area', compute: (v) => v.a * v.b * Math.sin(rad(v.th)) },
    ],
  },
  {
    id: 'trapezoid',
    name: 'Трапеция',
    category: '2d',
    blurb: 'Две стороны (основания) параллельны.',
    vars: [
      { key: 'a', label: 'Основание a', hint: 'Верхняя параллельная сторона.' },
      { key: 'b', label: 'Основание b', hint: 'Нижняя параллельная сторона.' },
      { key: 'h', label: 'Высота h', hint: 'Расстояние между основаниями.' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = ½·(a + b)·h', hint: 'Полусумма оснований на высоту.', dim: 'area', compute: (v) => ((v.a + v.b) / 2) * v.h },
      { key: 'm', label: 'Средняя линия', formula: 'm = (a + b)/2', hint: 'Линия посередине между основаниями.', dim: 'length', compute: (v) => (v.a + v.b) / 2 },
    ],
  },
  {
    id: 'isotrapezoid',
    name: 'Равнобедренная трапеция',
    category: '2d',
    blurb: 'Трапеция с равными боковыми сторонами.',
    vars: [
      { key: 'a', label: 'Верхнее основание a', hint: 'Короткая параллельная сторона.' },
      { key: 'b', label: 'Нижнее основание b', hint: 'Длинная параллельная сторона.' },
      { key: 'c', label: 'Боковая сторона c', hint: 'Одна из равных боковых сторон.' },
    ],
    validate: (v) => (2 * v.c > Math.abs(v.b - v.a) ? null : 'Боковая сторона слишком мала.'),
    results: [
      { key: 'h', label: 'Высота', formula: 'h = √(c² − ((b−a)/2)²)', hint: 'Высота между основаниями.', dim: 'length', compute: (v) => Math.sqrt(v.c ** 2 - ((v.b - v.a) / 2) ** 2) },
      { key: 'P', label: 'Периметр', formula: 'P = a + b + 2·c', hint: 'Сумма сторон.', dim: 'length', compute: (v) => v.a + v.b + 2 * v.c },
      { key: 'A', label: 'Площадь', formula: 'A = ½·(a + b)·h', hint: 'Полусумма оснований на высоту.', dim: 'area', compute: (v) => ((v.a + v.b) / 2) * Math.sqrt(v.c ** 2 - ((v.b - v.a) / 2) ** 2) },
    ],
  },
  {
    id: 'kite',
    name: 'Кайт',
    category: '2d',
    blurb: 'Дельтоид: две пары равных смежных сторон, диагонали перпендикулярны.',
    vars: [
      { key: 'd1', label: 'Диагональ d₁', hint: 'Первая диагональ.' },
      { key: 'd2', label: 'Диагональ d₂', hint: 'Вторая диагональ (перпендикулярна d₁).' },
      { key: 'a', label: 'Сторона a', hint: 'Длина одной пары сторон.' },
      { key: 'b', label: 'Сторона b', hint: 'Длина другой пары сторон.' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = ½·d₁·d₂', hint: 'Половина произведения диагоналей.', dim: 'area', compute: (v) => (v.d1 * v.d2) / 2 },
      { key: 'P', label: 'Периметр', formula: 'P = 2·(a + b)', hint: 'Сумма сторон.', dim: 'length', compute: (v) => 2 * (v.a + v.b) },
    ],
  },
  {
    id: 'circle',
    name: 'Круг',
    category: '2d',
    blurb: 'Все точки на равном расстоянии r от центра.',
    vars: [{ key: 'r', label: 'Радиус r', hint: 'От центра до края.' }],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = π·r²', hint: 'Площадь круга.', dim: 'area', compute: (v) => PI * v.r ** 2 },
      { key: 'C', label: 'Длина окружности', formula: 'C = 2·π·r', hint: 'Периметр круга.', dim: 'length', compute: (v) => 2 * PI * v.r },
      { key: 'd', label: 'Диаметр', formula: 'd = 2·r', hint: 'Через центр.', dim: 'length', compute: (v) => 2 * v.r },
    ],
  },
  {
    id: 'ellipse',
    name: 'Эллипс',
    category: '2d',
    blurb: 'Овал с двумя полуосями.',
    vars: [
      { key: 'r1', label: 'Полуось a (r₁)', hint: 'Половина большой оси.' },
      { key: 'r2', label: 'Полуось b (r₂)', hint: 'Половина малой оси.' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = π·r₁·r₂', hint: 'Произведение полуосей на π.', dim: 'area', compute: (v) => PI * v.r1 * v.r2 },
      { key: 'P', label: 'Периметр (прибл.)', formula: 'P ≈ 2·π·√((r₁² + r₂²)/2)', hint: 'Приближённая длина эллипса.', dim: 'length', compute: (v) => 2 * PI * Math.sqrt((v.r1 ** 2 + v.r2 ** 2) / 2) },
    ],
  },
  {
    id: 'annulus',
    name: 'Кольцо',
    category: '2d',
    blurb: 'Область между двумя концентрическими окружностями.',
    vars: [
      { key: 'R', label: 'Внешний радиус R', hint: 'Радиус внешней окружности.' },
      { key: 'r', label: 'Внутренний радиус r', hint: 'Радиус внутренней окружности (отверстия).' },
    ],
    validate: (v) => (v.R > v.r ? null : 'Внешний радиус должен быть больше внутреннего.'),
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = π·(R² − r²)', hint: 'Площадь большого круга минус малого.', dim: 'area', compute: (v) => PI * (v.R ** 2 - v.r ** 2) },
    ],
  },
  {
    id: 'sector',
    name: 'Сектор круга',
    category: '2d',
    blurb: 'Часть круга между двумя радиусами (в справочниках иногда «сегмент»).',
    vars: [
      { key: 'r', label: 'Радиус r', hint: 'Радиус круга.' },
      { key: 'th', label: 'Угол θ (°)', hint: 'Центральный угол сектора, в градусах.' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = π·r²·(θ/360)', hint: 'Доля площади круга.', dim: 'area', compute: (v) => PI * v.r ** 2 * (v.th / 360) },
      { key: 'L', label: 'Длина дуги', formula: 'L = 2·π·r·(θ/360)', hint: 'Дуга сектора.', dim: 'length', compute: (v) => 2 * PI * v.r * (v.th / 360) },
      { key: 'P', label: 'Периметр', formula: 'P = L + 2·r', hint: 'Дуга плюс два радиуса.', dim: 'length', compute: (v) => 2 * PI * v.r * (v.th / 360) + 2 * v.r },
    ],
  },
  {
    id: 'rhombus',
    name: 'Ромб',
    category: '2d',
    blurb: 'Параллелограмм с равными сторонами; задаём диагоналями.',
    vars: [
      { key: 'd1', label: 'Диагональ d₁', hint: 'Первая диагональ.' },
      { key: 'd2', label: 'Диагональ d₂', hint: 'Вторая диагональ (перпендикулярна d₁).' },
    ],
    results: [
      { key: 'A', label: 'Площадь', formula: 'A = ½·d₁·d₂', hint: 'Половина произведения диагоналей.', dim: 'area', compute: (v) => (v.d1 * v.d2) / 2 },
      { key: 'a', label: 'Сторона', formula: 'a = ½·√(d₁² + d₂²)', hint: 'Через половины диагоналей.', dim: 'length', compute: (v) => Math.hypot(v.d1, v.d2) / 2 },
      { key: 'P', label: 'Периметр', formula: 'P = 4·a', hint: 'Сумма сторон.', dim: 'length', compute: (v) => 2 * Math.hypot(v.d1, v.d2) },
    ],
  },
  {
    id: 'polygon',
    name: 'Правильный многоугольник',
    category: '2d',
    blurb: 'n равных сторон и равных углов (5 сторон — пятиугольник, 6 — шестиугольник…).',
    vars: [
      { key: 'n', label: 'Число сторон n', hint: 'Сколько сторон, целое число ≥ 3.' },
      { key: 's', label: 'Сторона s', hint: 'Длина одной стороны.' },
    ],
    validate: (v) => (Number.isInteger(v.n) && v.n >= 3 ? null : 'Число сторон — целое и не меньше 3.'),
    results: [
      { key: 'P', label: 'Периметр', formula: 'P = n·s', hint: 'Все стороны равны.', dim: 'length', compute: (v) => v.n * v.s },
      { key: 'A', label: 'Площадь', formula: 'A = n·s² / (4·tan(180°/n))', hint: 'Площадь правильного n-угольника.', dim: 'area', compute: (v) => (v.n * v.s ** 2) / (4 * Math.tan(PI / v.n)) },
      { key: 'ang', label: 'Внутренний угол', formula: '(n − 2)·180° / n', hint: 'Угол при каждой вершине.', dim: 'angle', compute: (v) => ((v.n - 2) * 180) / v.n },
    ],
  },
];

const SHAPES_3D: ShapeDef[] = [
  {
    id: 'cube',
    name: 'Куб',
    category: '3d',
    blurb: 'Шесть равных квадратных граней.',
    vars: [{ key: 'a', label: 'Ребро a', hint: 'Длина ребра.' }],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = a³', hint: 'Ребро в кубе.', dim: 'volume', compute: (v) => v.a ** 3 },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = 6·a²', hint: 'Шесть граней.', dim: 'area', compute: (v) => 6 * v.a ** 2 },
      { key: 'd', label: 'Диагональ', formula: 'd = a·√3', hint: 'Пространственная диагональ.', dim: 'length', compute: (v) => v.a * Math.sqrt(3) },
    ],
  },
  {
    id: 'cuboid',
    name: 'Кубоид',
    category: '3d',
    blurb: 'Прямоугольный параллелепипед (коробка).',
    vars: [
      { key: 'a', label: 'Длина a', hint: 'Одно ребро.' },
      { key: 'b', label: 'Ширина b', hint: 'Второе ребро.' },
      { key: 'c', label: 'Высота c', hint: 'Третье ребро.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = a·b·c', hint: 'Произведение рёбер.', dim: 'volume', compute: (v) => v.a * v.b * v.c },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = 2·(a·b + b·c + c·a)', hint: 'Сумма шести граней.', dim: 'area', compute: (v) => 2 * (v.a * v.b + v.b * v.c + v.c * v.a) },
      { key: 'd', label: 'Диагональ', formula: 'd = √(a² + b² + c²)', hint: 'Пространственная диагональ.', dim: 'length', compute: (v) => Math.sqrt(v.a ** 2 + v.b ** 2 + v.c ** 2) },
    ],
  },
  {
    id: 'cone',
    name: 'Конус',
    category: '3d',
    blurb: 'Круглое основание, сходящееся в вершину.',
    vars: [
      { key: 'r', label: 'Радиус основания r', hint: 'Радиус нижнего круга.' },
      { key: 'h', label: 'Высота h', hint: 'От основания до вершины (перпендикуляр).' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅓·π·r²·h', hint: 'Треть от цилиндра.', dim: 'volume', compute: (v) => (PI * v.r ** 2 * v.h) / 3 },
      { key: 'l', label: 'Образующая', formula: 'l = √(r² + h²)', hint: 'Боковая сторона (наклонная).', dim: 'length', compute: (v) => Math.hypot(v.r, v.h) },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = π·r·l + π·r²', hint: 'Боковая плюс основание.', dim: 'area', compute: (v) => PI * v.r * Math.hypot(v.r, v.h) + PI * v.r ** 2 },
    ],
  },
  {
    id: 'cylinder',
    name: 'Цилиндр',
    category: '3d',
    blurb: 'Два круглых основания, соединённых боковой поверхностью.',
    vars: [
      { key: 'r', label: 'Радиус r', hint: 'Радиус основания.' },
      { key: 'h', label: 'Высота h', hint: 'Расстояние между основаниями.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = π·r²·h', hint: 'Площадь основания на высоту.', dim: 'volume', compute: (v) => PI * v.r ** 2 * v.h },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = 2·π·r·h + 2·π·r²', hint: 'Боковая плюс два основания.', dim: 'area', compute: (v) => 2 * PI * v.r * v.h + 2 * PI * v.r ** 2 },
      { key: 'S', label: 'Боковая поверхность', formula: 'S = 2·π·r·h', hint: 'Только боковая стенка.', dim: 'area', compute: (v) => 2 * PI * v.r * v.h },
    ],
  },
  {
    id: 'sphere',
    name: 'Сфера',
    category: '3d',
    blurb: 'Все точки на равном расстоянии r от центра.',
    vars: [{ key: 'r', label: 'Радиус r', hint: 'От центра до поверхности.' }],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = 4/3·π·r³', hint: 'Объём шара.', dim: 'volume', compute: (v) => (4 / 3) * PI * v.r ** 3 },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = 4·π·r²', hint: 'Площадь сферы.', dim: 'area', compute: (v) => 4 * PI * v.r ** 2 },
    ],
  },
  {
    id: 'ellipsoid',
    name: 'Эллипсоид',
    category: '3d',
    blurb: 'Сфера, растянутая по трём полуосям.',
    vars: [
      { key: 'a', label: 'Полуось a', hint: 'Половина оси по x.' },
      { key: 'b', label: 'Полуось b', hint: 'Половина оси по y.' },
      { key: 'c', label: 'Полуось c', hint: 'Половина оси по z.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = 4/3·π·a·b·c', hint: 'Произведение полуосей.', dim: 'volume', compute: (v) => (4 / 3) * PI * v.a * v.b * v.c },
    ],
  },
  {
    id: 'barrel',
    name: 'Бочка',
    category: '3d',
    blurb: 'Бочкообразное тело с выпуклой стенкой.',
    vars: [
      { key: 'D', label: 'Диаметр в середине D', hint: 'Наибольший диаметр (посередине).' },
      { key: 'd', label: 'Диаметр у краёв d', hint: 'Диаметр у оснований.' },
      { key: 'h', label: 'Высота h', hint: 'Высота бочки.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = π·h·(2·D² + d²) / 12', hint: 'Приближённый объём бочки.', dim: 'volume', compute: (v) => (PI * v.h * (2 * v.D ** 2 + v.d ** 2)) / 12 },
    ],
  },
  {
    id: 'hollow-cylinder',
    name: 'Полый цилиндр',
    category: '3d',
    blurb: 'Труба: цилиндр с цилиндрическим отверстием.',
    vars: [
      { key: 'R', label: 'Внешний радиус R', hint: 'Радиус внешней стенки.' },
      { key: 'r', label: 'Внутренний радиус r', hint: 'Радиус отверстия.' },
      { key: 'h', label: 'Высота h', hint: 'Высота трубы.' },
    ],
    validate: (v) => (v.R > v.r ? null : 'Внешний радиус должен быть больше внутреннего.'),
    results: [
      { key: 'V', label: 'Объём', formula: 'V = π·h·(R² − r²)', hint: 'Объём стенки трубы.', dim: 'volume', compute: (v) => PI * v.h * (v.R ** 2 - v.r ** 2) },
      { key: 'L', label: 'Боковая поверхность', formula: 'L = 2·π·h·(R + r)', hint: 'Внешняя плюс внутренняя стенки.', dim: 'area', compute: (v) => 2 * PI * v.h * (v.R + v.r) },
      { key: 'S', label: 'Полная поверхность', formula: 'S = L + 2·π·(R² − r²)', hint: 'Стенки плюс два кольца-торца.', dim: 'area', compute: (v) => 2 * PI * v.h * (v.R + v.r) + 2 * PI * (v.R ** 2 - v.r ** 2) },
    ],
  },
  {
    id: 'cone-frustum',
    name: 'Усечённый конус',
    category: '3d',
    blurb: 'Конус со срезанной верхушкой.',
    vars: [
      { key: 'R', label: 'Нижний радиус R', hint: 'Радиус большего основания.' },
      { key: 'r', label: 'Верхний радиус r', hint: 'Радиус меньшего основания.' },
      { key: 'h', label: 'Высота h', hint: 'Между основаниями.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅓·π·h·(R² + R·r + r²)', hint: 'Объём усечённого конуса.', dim: 'volume', compute: (v) => (PI * v.h * (v.R ** 2 + v.R * v.r + v.r ** 2)) / 3 },
      { key: 'l', label: 'Образующая', formula: 'l = √((R − r)² + h²)', hint: 'Наклонная боковая сторона.', dim: 'length', compute: (v) => Math.hypot(v.R - v.r, v.h) },
      { key: 'A', label: 'Площадь поверхности', formula: 'A = π·(R + r)·l + π·R² + π·r²', hint: 'Боковая плюс оба основания.', dim: 'area', compute: (v) => PI * (v.R + v.r) * Math.hypot(v.R - v.r, v.h) + PI * v.R ** 2 + PI * v.r ** 2 },
    ],
  },
  {
    id: 'pyramid-frustum',
    name: 'Усечённая пирамида',
    category: '3d',
    blurb: 'Пирамида со срезанной верхушкой; квадратные основания.',
    vars: [
      { key: 'a', label: 'Нижняя сторона a', hint: 'Сторона большего квадрата.' },
      { key: 'b', label: 'Верхняя сторона b', hint: 'Сторона меньшего квадрата.' },
      { key: 'h', label: 'Высота h', hint: 'Между основаниями.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = (h/3)·(a² + a·b + b²)', hint: 'Объём усечённой пирамиды.', dim: 'volume', compute: (v) => (v.h / 3) * (v.a ** 2 + v.a * v.b + v.b ** 2) },
    ],
  },
  {
    id: 'hollow-sphere',
    name: 'Полая сфера',
    category: '3d',
    blurb: 'Шаровой слой между двумя сферами.',
    vars: [
      { key: 'R', label: 'Внешний радиус R', hint: 'Радиус внешней сферы.' },
      { key: 'r', label: 'Внутренний радиус r', hint: 'Радиус внутренней полости.' },
    ],
    validate: (v) => (v.R > v.r ? null : 'Внешний радиус должен быть больше внутреннего.'),
    results: [
      { key: 'V', label: 'Объём', formula: 'V = 4/3·π·(R³ − r³)', hint: 'Объём стенки.', dim: 'volume', compute: (v) => (4 / 3) * PI * (v.R ** 3 - v.r ** 3) },
    ],
  },
  {
    id: 'pyramid',
    name: 'Пирамида',
    category: '3d',
    blurb: 'Пирамида с прямоугольным основанием.',
    vars: [
      { key: 'l', label: 'Длина основания l', hint: 'Одна сторона прямоугольника.' },
      { key: 'w', label: 'Ширина основания w', hint: 'Вторая сторона прямоугольника.' },
      { key: 'h', label: 'Высота h', hint: 'От основания до вершины.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅓·l·w·h', hint: 'Треть от коробки.', dim: 'volume', compute: (v) => (v.l * v.w * v.h) / 3 },
      { key: 'Sb', label: 'Площадь основания', formula: 'S = l·w', hint: 'Прямоугольное основание.', dim: 'area', compute: (v) => v.l * v.w },
    ],
  },
  {
    id: 'triangular-pyramid',
    name: 'Треугольная пирамида',
    category: '3d',
    blurb: 'Пирамида с треугольным основанием.',
    vars: [
      { key: 'a', label: 'Основание треугольника a', hint: 'Сторона треугольника-основания.' },
      { key: 'hb', label: 'Высота треугольника h₀', hint: 'Высота основания к стороне a.' },
      { key: 'h', label: 'Высота пирамиды h', hint: 'От основания до вершины.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅓·(½·a·h₀)·h', hint: 'Треть площади основания на высоту.', dim: 'volume', compute: (v) => ((v.a * v.hb) / 2) * v.h / 3 },
    ],
  },
  {
    id: 'pentagonal-pyramid',
    name: 'Пятиугольная пирамида',
    category: '3d',
    blurb: 'Пирамида с правильным пятиугольным основанием.',
    vars: [
      { key: 's', label: 'Сторона основания s', hint: 'Сторона правильного пятиугольника.' },
      { key: 'h', label: 'Высота h', hint: 'От основания до вершины.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅓·(5·s² / (4·tan 36°))·h', hint: 'Треть площади пятиугольника на высоту.', dim: 'volume', compute: (v) => ((5 * v.s ** 2) / (4 * Math.tan(PI / 5))) * v.h / 3 },
    ],
  },
  {
    id: 'hexagonal-pyramid',
    name: 'Шестиугольная пирамида',
    category: '3d',
    blurb: 'Пирамида с правильным шестиугольным основанием.',
    vars: [
      { key: 's', label: 'Сторона основания s', hint: 'Сторона правильного шестиугольника.' },
      { key: 'h', label: 'Высота h', hint: 'От основания до вершины.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = (√3/2)·s²·h', hint: 'Треть площади шестиугольника на высоту.', dim: 'volume', compute: (v) => (Math.sqrt(3) / 2) * v.s ** 2 * v.h },
    ],
  },
  {
    id: 'spherical-sector',
    name: 'Шаровой сектор',
    category: '3d',
    blurb: 'Сектор шара (в справочнике — «сфера сектора»).',
    vars: [
      { key: 'r', label: 'Радиус шара r', hint: 'Радиус всего шара.' },
      { key: 'h', label: 'Высота сегмента h', hint: 'Высота шапочки сектора.' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ⅔·π·r²·h', hint: 'Объём шарового сектора.', dim: 'volume', compute: (v) => (2 / 3) * PI * v.r ** 2 * v.h },
    ],
  },
  {
    id: 'triangular-prism',
    name: 'Треугольная призма',
    category: '3d',
    blurb: 'Призма с треугольным сечением.',
    vars: [
      { key: 'b', label: 'Основание b', hint: 'Основание треугольного торца.' },
      { key: 'h', label: 'Высота h', hint: 'Высота треугольного торца.' },
      { key: 'L', label: 'Длина L', hint: 'Длина призмы (глубина).' },
    ],
    results: [
      { key: 'V', label: 'Объём', formula: 'V = ½·b·h·L', hint: 'Площадь торца на длину.', dim: 'volume', compute: (v) => (v.b * v.h * v.L) / 2 },
    ],
  },
  {
    id: 'torus',
    name: 'Тор',
    category: '3d',
    blurb: 'Бублик: труба, замкнутая в кольцо.',
    vars: [
      { key: 'R', label: 'Радиус R', hint: 'От центра тора до центра трубы.' },
      { key: 'r', label: 'Радиус трубы r', hint: 'Радиус самой трубы.' },
    ],
    results: [
      { key: 'A', label: 'Площадь поверхности', formula: 'A = 4·π²·R·r', hint: 'Поверхность тора.', dim: 'area', compute: (v) => 4 * PI ** 2 * v.R * v.r },
      { key: 'V', label: 'Объём', formula: 'V = 2·π²·R·r²', hint: 'Объём тора.', dim: 'volume', compute: (v) => 2 * PI ** 2 * v.R * v.r ** 2 },
    ],
  },
];

export const SHAPES: ShapeDef[] = [...SHAPES_2D, ...SHAPES_3D];

export function getShape(id: string): ShapeDef | undefined {
  return SHAPES.find((s) => s.id === id);
}

export function shapesByCategory(category: ShapeCategory): ShapeDef[] {
  return SHAPES.filter((s) => s.category === category);
}

export function dimSuffix(dim: Dim): string {
  switch (dim) {
    case 'area':
      return ' ед²';
    case 'volume':
      return ' ед³';
    case 'length':
      return ' ед';
    case 'angle':
      return '°';
    default:
      return '';
  }
}
