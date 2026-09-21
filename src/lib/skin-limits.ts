// Лимитированные скины: когда их дают и что значит «лимитированный».
//
// Правило, ради которого всё и заведено: **взял, пока окно открыто — остался
// твоим навсегда**. Лимит здесь про то, когда скин можно ПОЛУЧИТЬ, а не про
// то, сколько им можно играть. Скин, который отбирают обратно, — это не
// награда, а обман: игрок выбрал его, привык, и в одно утро автомат выглядит
// иначе, потому что кончился календарь. Такого мы не делаем.
//
// Окна бывают двух видов, и оба нужны:
//   • СЕЗОННОЕ — повторяется каждый год (тыквы приезжают каждый октябрь).
//     Пропустил — вернётся, но через год.
//   • ДРОП — разовое окно с годом. Не успел — всё, только у тех, кто взял.

/** Окно доступности. `MM-DD`; `year` задан — окно разовое. */
export interface SkinWindow {
  from: string;
  until: string;
  year?: number;
}

const MS_DAY = 86_400_000;

function parseMd(md: string): [number, number] {
  const [m, d] = md.split('-').map(Number);
  return [m, d];
}

/** Полночь местного дня — окна считаем по дням, а не по часам. */
function dayStart(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

export interface WindowState {
  /** Окно открыто прямо сейчас. */
  open: boolean;
  /** Когда закроется (если открыто). */
  closesAt: number | null;
  /** Когда откроется снова (если закрыто и ещё откроется). */
  opensAt: number | null;
  /** Разовый дроп, который уже кончился и не вернётся. */
  gone: boolean;
}

/**
 * Состояние окна на момент `now`.
 *
 * Сезонное окно умеет переходить через Новый год (`from` позже `until`):
 * в этом случае оно открыто с декабря по январь, и «конец» лежит уже в
 * следующем году. Без этого зимний скин закрывался бы 1 января.
 */
export function windowState(win: SkinWindow, now: number = Date.now()): WindowState {
  const [fm, fd] = parseMd(win.from);
  const [um, ud] = parseMd(win.until);
  // Конец — это КОНЕЦ дня `until`, иначе в последний день скин уже не дают.
  const endOf = (y: number) => dayStart(y, um, ud) + MS_DAY;

  if (win.year !== undefined) {
    const start = dayStart(win.year, fm, fd);
    // Разовый дроп через Новый год заканчивается в следующем году.
    const end = endOf(fm > um ? win.year + 1 : win.year);
    if (now < start) return { open: false, closesAt: null, opensAt: start, gone: false };
    if (now < end) return { open: true, closesAt: end, opensAt: null, gone: false };
    return { open: false, closesAt: null, opensAt: null, gone: true };
  }

  const y = new Date(now).getFullYear();
  // Проверяем окна, начавшиеся в прошлом и этом году: то, что открылось в
  // декабре, всё ещё может быть открыто в январе.
  for (const startYear of [y - 1, y]) {
    const start = dayStart(startYear, fm, fd);
    const end = endOf(fm > um ? startYear + 1 : startYear);
    if (now >= start && now < end) {
      return { open: true, closesAt: end, opensAt: null, gone: false };
    }
  }
  // Закрыто — ближайшее открытие в этом году или в следующем.
  const thisYear = dayStart(y, fm, fd);
  const opensAt = now < thisYear ? thisYear : dayStart(y + 1, fm, fd);
  return { open: false, closesAt: null, opensAt, gone: false };
}

/**
 * Сколько дней осталось до `at`, с округлением ВВЕРХ: пока идёт последний
 * день, честно говорить «остался 1 день», а не «осталось 0».
 */
export function daysUntil(at: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((at - now) / MS_DAY));
}

const DAY_FORMS: [string, string, string] = ['день', 'дня', 'дней'];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «1 день», «2 дня», «11 дней» — русская форма по числу. */
export function daysWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return DAY_FORMS[2];
  if (mod10 === 1) return DAY_FORMS[0];
  if (mod10 >= 2 && mod10 <= 4) return DAY_FORMS[1];
  return DAY_FORMS[2];
}

/** Подпись под карточкой: что именно значит лимит прямо сейчас. */
export function limitLabel(win: SkinWindow, owned: boolean, now: number = Date.now()): string {
  // Забрал — и срок больше не про тебя. Дни торопят только того, кто ещё
  // не взял; владельцу тот же счётчик был бы шумом.
  if (owned) return 'ваш навсегда';
  const st = windowState(win, now);
  if (st.open) {
    const left = daysUntil(st.closesAt!, now);
    return left <= 1 ? 'успеть: последний день' : `успеть: осталось ${left} ${daysWord(left)}`;
  }
  if (st.gone) return 'дроп закончился';
  const d = new Date(st.opensAt!);
  return `вернётся ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
