import { describe, expect, mock, test } from "claude-code/testing";

// Заглушки — до первого обращения к `$`: модель отвечает расходом из `usage.next`,
// пустой `AbovePrompt` (когда мод отдаёт `next(e)`) рисует пустой текст.
function stubs(on: any, now = 0) {
  const usage: { next: Record<string, number> | null } = { next: null };
  const clock = mock.clock(on, { now });
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Text({ children: "" }));
  on("turn.step", async function* (_: any, e: any) {
    yield { kind: "text", index: 0, text: "ok" };
    return { turnId: e.turnId, index: e.index, answer: "ok", toolUses: [], stopReason: "end_turn", usage: usage.next };
  });
  return { usage, clock };
}

async function step($: any, agentId?: string) {
  const stream = $.turn.step({ turnId: "t", index: 0, model: "claude-test", messageCount: 1, agentId });
  let s = await stream.next();
  while (s.done !== true) s = await stream.next();
}

async function start($: any, bodyColumns = 120) {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
  return $.ui.mount({
    plugin: "cache-meter",
    surface: "terminal",
    component: "AbovePrompt",
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
  } as any);
}

const u = (read: number, write = 0, input = 0) => ({
  input_tokens: input,
  output_tokens: 1,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});

describe("cache-meter", () => {
  test("до первого запроса строки нет", async ($, on) => {
    stubs(on);
    const ui = await start($);
    expect(await ui.find({ type: "Text", text: /кеш/ })).toBeUndefined();
    await ui.unmount();
  });

  test("показывает кеш последнего запроса, долю и время", async ($, on) => {
    const { usage, clock } = stubs(on, 1_000_000);
    const ui = await start($);
    usage.next = u(168_200, 3_100, 2_000);
    await step($);
    expect(await ui.find({ type: "Text", text: /◆ кеш 171,3k/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /↓168,2k чтение ↑3,1k запись/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /97% из кеша/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /только что/ })).toBeDefined();
    await clock.advance(12 * 60_000);
    expect(await ui.find({ type: "Text", text: /12 мин назад/ })).toBeDefined();
    await ui.unmount();
  });

  test("подагенты считаются отдельно и не трогают последний запрос", async ($, on) => {
    const { usage } = stubs(on);
    const ui = await start($);
    usage.next = u(50_000);
    await step($);
    usage.next = u(2_100_000);
    await step($, "a1");
    expect(await ui.find({ type: "Text", text: /◆ кеш 50k/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /агенты ↓2,1M/ })).toBeDefined();
    await ui.unmount();
  });

  test("в узкой строке — только главное", async ($, on) => {
    const { usage } = stubs(on);
    const ui = await start($, 50);
    usage.next = u(10_000);
    await step($);
    expect(await ui.find({ type: "Text", text: /◆ кеш 10k/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /чтение/ })).toBeUndefined();
    await ui.unmount();
  });
});
