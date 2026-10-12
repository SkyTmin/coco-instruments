// Cache Meter: над полем ввода — сколько токенов в кеше промпта.
//
// После каждого запроса к модели (`turn.step`) Claude API сообщает, сколько
// токенов запроса прочитано из кеша и сколько записано в него. Строка
// показывает последний запрос главного диалога: «в кеше» = прочитано +
// записано (столько лежит в кеше после запроса), долю из кеша и сколько
// прошло с запроса. Кеш живёт недолго (5 мин или час, по настройкам), поэтому
// время красится: до 5 мин — зелёным, до часа — жёлтым, дальше — красным.
// Справа — итоги сессии: сколько прочитали из кеша подагенты и главный диалог.

const STATS = { plugin: "cache-meter", key: "stats" };
const EMPTY = { last: null, read: 0, write: 0, agentRead: 0, agentWrite: 0 };

// Запросы подагентов идут параллельно: записи в счёт — по очереди.
let queue = Promise.resolve();

export function register(on) {
  on("session.start", async ($, e, next) => {
    // Раз в 30 с — перерисовать: «N мин назад» растёт и без запросов.
    $.clock.every(30_000, () => $.ui.invalidate("ui.render"));
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    const result = yield* next(e);
    const u = result?.usage;
    if (u) {
      const agent = !!e.agentId;
      queue = queue.then(() => count($, u, agent)).catch(() => {});
      await queue;
    }
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value: s = EMPTY } = await $.state.get(STATS);
    if (e.props.hasSurvey || !s.last) return next(e);
    const now = await $.clock.now();
    const { Box, Text } = $.ui.resolve(e);
    return band(Box, Text, s, now, e.props.bodyColumns ?? 80);
  });
}

async function count($, u, agent) {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const { value: s = EMPTY } = await $.state.get(STATS);
  const next = agent
    ? { ...s, agentRead: s.agentRead + read, agentWrite: s.agentWrite + write }
    : {
        ...s,
        read: s.read + read,
        write: s.write + write,
        last: { read, write, input: u.input_tokens ?? 0, at: await $.clock.now() },
      };
  await $.state.set(STATS, next);
}

function band(Box, Text, s, now, columns) {
  const { read, write, input, at } = s.last;
  const total = read + write + input;
  const hit = total ? Math.round((read / total) * 100) : 0;
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  const ageColor = mins < 5 ? "green" : mins < 60 ? "yellow" : "red";
  const parts = [
    Text({ color: "cyan", bold: true, children: `◆ кеш ${short(read + write)}` }),
    Text({ dimColor: true, children: `  ${hit}% из кеша` }),
    Text({ color: ageColor, children: `  · ${age(mins)}` }),
  ];
  if (columns >= 70) {
    parts.splice(
      1,
      0,
      Text({ dimColor: true, children: `  ↓${short(read)} чтение ↑${short(write)} запись` }),
    );
    parts.push(Text({ dimColor: true, children: `  │ сессия ↓${short(s.read)}` }));
    if (s.agentRead || s.agentWrite)
      parts.push(Text({ dimColor: true, children: `  │ агенты ↓${short(s.agentRead)}` }));
  }
  return Box({ flexDirection: "row", paddingX: 1, children: parts });
}

function age(mins) {
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const h = Math.floor(mins / 60);
  return `${h} ч ${mins % 60} мин назад`;
}

function short(n) {
  const f = (x) => String(+x.toFixed(1)).replace(".", ",");
  if (n >= 1_000_000) return `${f(n / 1_000_000)}M`;
  if (n >= 1_000) return `${f(n / 1_000)}k`;
  return String(n);
}
