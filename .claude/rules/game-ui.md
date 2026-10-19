---
paths:
  - "src/game-ui.css"
  - "src/inventory.css"
  - "src/components/{gx,icons,PrisonCamp,DungeonCamp}.tsx"
  - "src/components/gx-px.css"
  - "src/components/AudioToggles.tsx"
  - "public/ui/CREDITS.txt"
---

<!-- Перенесено из CLAUDE.md дословно (v2.87): грузится, только когда
     открыт файл из `paths`. Тема: Игровой интерфейс (рамки, иконки, без жаргона). -->

## Игровой интерфейс (v2.62.0) — `src/game-ui.css`, `components/gx.tsx`

Владелец: «менюшки везде ужасны… это игра, дизайн должен быть красивым и
очень понятным», «не люблю, когда в игре разъясняют комментариями», «что за
Клеть?», «Удар, Вихрь — нужен интерактив, а не текст», «инвентарь и
прокачку нашёл, только потыкав везде». Переодеты зал игр, двор, шахта, лес,
лагерь, подземелье (лобби, вылазка, шахта внизу) и все их окна.

- **Набор — готовый, а не нарисованный.** Рамки, кнопки, ленты, полоски,
  шестигранники — Kenney «UI Pack - Adventure» (CC0); системные значки —
  Kenney «Game Icons» (CC0); картинки действий и зданий — game-icons.net
  (**CC BY 3.0 — атрибуция обязательна**, авторы в `public/ui/CREDITS.txt`;
  добавили иконку нового автора — допишите его туда); шрифт — Rubik (OFL),
  урезан до латиницы и кириллицы (`GxRubik`). Репозиторий публичный: другие
  лицензии не берём.
- **Иконки — маски, а не картинки.** SVG game-icons лежат с вырезанным
  чёрным квадратом фона и заливкой `#000`; `GxIcon` кладёт их в
  `mask`, цвет — `currentColor`. Поэтому одна иконка годится и на пергамент,
  и на тёмное дерево. `KIcon` — то же для PNG Kenney.
- **Рамки — `border-image` один к одному.** Срез равен канту картинки, иначе
  кант растягивается в середину. У `panel_brown_corners_a` кант 10 точек,
  у остальных 8 (у тёмных 6 — лишние две точки там цвета заливки и не
  видны). Первая сборка резала рамку «с уголками» по 8 — во всех окнах
  внутри пергамента шла бурая кайма. Новую рамку меряйте скриптом
  по пикселям, а не на глаз.
- **Компоненты** (`components/gx.tsx`): `GxModal` (окно с лентой и
  крестиком снаружи прокрутки), `GxSheet` (лист снизу — лагерь, торговец),
  `GameTop` (назад, лента, фишки валют), `GxBar`, `GxIcon`, `KIcon`. Окна
  встают в `escape-stack`: «Назад» Telegram закрывает сперва их. С волны 2
  они на пиксельном наборе — см. «Window chrome on the kit» ниже (Kenney
  остался только у `gx-panel`, `gx-ribbon`, `gx-hex`).
- **Лагерь не переписан, а перекрашен.** Внутри `.gx-camp .gx-sheet__body`
  переопределены переменные темы приложения (`--surface-2`, `--text`,
  `--muted`…) под пергамент — все вкладки посветлели разом. Новую вкладку
  пишите на тех же переменных, а не на своих цветах.
- **Никаких простыней.** Абзацы «как это работает» убраны отовсюду. Что
  нужно знать — видно (полоска, фишка, «!»), подсказка — по тапу (задание
  шахты: тап по нему показывает подсказку тостом) или руками первого раза:
  в подземелье — шаги `dg.coach.v1` в localStorage, в лесу — две руки над
  стволом, пока не срублено ни одного бревна. Оставлены только
  предупреждения о необратимом (сброс, смерть забирает рюкзак).
- **Переименовано в интерфейсе** (имена в коде и в разделах выше —
  прежние, это нарочно): Клеть → Лифт, Сидор → Рюкзак, Устье → Вход в
  шахты, Откатка → Рельсовые туннели, пасюк → серая крыса, Передачка →
  Посылка (здесь и в комментариях кода), Барыга → Торговец, Бригада →
  Рабочие, Вехи → Достижения, Перки → Навыки, Лесоповал → Лес, «Запал» →
  серия с иконкой огня (ступени Разогрев…Легенда забоя остались), норма →
  «порода для ранга», откуп → «докупить породу/брёвна», проводник → задания.
  Не возвращайте жаргон: владелец его не понимает, а он — целевой игрок.
- **Шахта и лес — один каркас** (`.pmx-*`): шапка с лентой, фишки монет и
  токенов, полоса ранга «буква → полоска с ценой и породой → буква»,
  круглые расходники, рюкзак/штабель с полоской и красной «Продать», лагерь
  квадратом. Всё шириной рамы поля (`--pw`). Высота под полем замерена
  на стенде: `--below` 362 px, с заданием 384; сцена леса — `100dvh − 290`.
  Поменяли низ — перемерьте, иначе поле уйдёт под край.
- **Указатели в подземелье — без текста.** Табличка на карте — столб со
  стрелками; подходишь — карточка на табло: ближайшие лифт, шахта и логово,
  стрелка по направлению и метры. Только табличка у логова (`nearLair`,
  14 клеток до короля) открывает окно «Логово короля».
- **«!» на снаряжении** считает `upgradable()` (`lib/dungeon.ts`): можно ли
  сейчас заточить или перековать с учётом кошелька, склада и рюкзака. Одна
  функция на табло, лобби, инвентарь и вкладку снаряжения.
- **Обложки районов** (`public/ui/areas/`) — кадры самой игры, вырезанные с
  канвы и высветленные ×1,45: картинка обещает ровно то, что будет внизу.
- **Старый CSS меню вычищен** (≈1600 строк `phud`, `pbag`, `pforge-btn`,
  `dg-top`, `dg-btn`…) скриптом на postcss: правило удалялось, если его
  класс не встречается ни в одном `src/**/*.ts*`. Ловушка — классы,
  собранные шаблоном (`dg-banner--${tone}`, `dg-shaft--${dir}`): их такой
  поиск не видит, при следующей чистке исключайте их руками.
- Шестерёнка в правом верхнем углу на стенде — отладчик Eruda, она есть
  только в разработке и перекрывает правую кнопку шапки: кликайте в
  скриптах через `element.click()`.

## Window chrome on the kit (wave 2 — C, 13.10.2026) — `gx.tsx`, `gx-px.css`

Props of `GxModal`, `GxSheet`, `GameTop`, `GxBar`, `GxIcon`, `KIcon` are unchanged; the look is
the pixel kit (`@/ui-px`). All chrome CSS lives in `components/gx-px.css`; `game-ui.css` lost
the old modal / sheet / header / tabs / button / badge / bar / chip blocks.

- **One window shell** (`GxWindow`): veil `.gx-win.gx-win--modal|--sheet` (old classes
  `gx-modal` / `gx-sheet` kept on it, `data-ui-layer`) → `Panel` box (`.gx-win__box`, also
  `gx-modal__box` / `gx-sheet__box`) → kit ribbon `.gx-win__title` + kit red `Button` ✕
  `.gx-win__close` (a `*__close` class: first focus skips it) → optional tabs `.gx-win__tabs` →
  `Panel` body `.gx-win__body`. Escape stack untouched. Looks: `GxModal frame` paper → wood +
  parch body, wood → wood + well, iron / iron-dark → iron + parch / well; sheets wood + parch.
- **Header contract:** `--gx-top-h` (max(48 px, 22u)) is the GameTop row height; windows start
  BELOW it (veil padding-top = safe top + `--gx-top-h`), so the ✕ never covers the header ⚙ /
  money. Exception: phone landscape (no room) — windows are centred under 6u. Touch targets:
  `--gx-hit` (max(44 px, 19u)).
- **Sizes per format:** phone portrait — docked to the bottom, full width, safe-bottom padding;
  elsewhere centred, width `min(100%, --gx-mw · u)`: modal 200, sheet 230, tablist window
  (settings) 300, camp with a rail / any window with kit content or kit tabs in its body 420.
  Camps and tablist windows have a FIXED height (`min(100%, 250u)`, 100 % on phone portrait):
  switching tabs never moves the frame, ribbon or tab bar (checked by comparing rects across all
  tabs — `{SCR}/jump.mjs`). Old tab content in a wide camp is centred at max 720 px.
- **Zoom for old content:** at `--ui-scale` ≥ 4 the body gets `zoom: 2` (`--gx-z` on the veil)
  and `--u` is divided back so art stays one `--ui-px`. Kit type sizes are px too, and a custom
  property is resolved where it is declared (:root) — so the body re-derives `--px-fs*` from
  copies taken at :root (`--gx-fs*`) divided by `--gx-z`. A NEW kit size var needs a line
  there. Kit content (`.gx-win__body:has(.px)`) is NOT zoomed and gets the kit well. A window
  opened inside a zoomed body (NestSheet) is a DOM child: its body is not zoomed again.
- **Camp (`PrisonCamp`):** kit `Tabs` with `TAB_ICONS` art, the word in `data-tip` /
  `aria-label`; a left rail (`vertical`) on landscape / tablet / desktop, a top strip on phone
  portrait; compact phones hide the label and put the tab name in the ribbon. The camp row is
  `main`: an inner kit tab row (PetsTab) then leaves Tab / Shift+Tab / LB / RB to it.
- **GameTop:** back `Button`, kit ribbon title, chips, right buttons in one row, never wrapping.
  Fit levels (wave 3, Q) on `.gx-top__row[data-fit]`, set on the DOM (no render) by a layout
  effect each render + ResizeObserver + `document.fonts` `loadingdone` (fit before the web font
  loads cut the casino title): 0 all; 1 title goes (sr-only, `is-tight`; a title cut to «…» counts
  as not fitting); 2 the `right` group folds into one ⚙ `.gx-top__gear` that opens
  `GameSettings` on the Sound tab (lazy import: `@/settings` imports gx); 3 `data-pri='3'` chips
  hide; 4 `data-pri='2'` too. Priority 1 (money) never hides. On phone portrait chips are
  `--px-fs-sm`. Pass chips as `TopChip[]` (`id, icon, value, name, pri, ch, onClick`): values go
  through `fmtCompact` (i18n/core: `Intl` compact ≥ 10 000, «511 млн», «9,8 Mio.»), the exact
  value is in `data-tip` / `aria-label`, `ch` sets a `min-width` so a changing number doesn't
  move neighbours. A chip with `onClick` is a button (`.gx-chip--btn`); the first pri-1 chip with
  a value opens the wallet popover (`.gx-wallet`, exact values of all chips, Esc / outside tap
  closes). A ReactNode `chips` still works (old callers). Measured: yard / casino / dungeon rows
  fit at 360/390/440 portrait and 6 formats × ru/de/tr with 510 812 345 coins.
  Round 2 (critic): `ch` — the widest compact form in any language is 6.71 ch of the chip font
  (ru «1,2 млрд»; `scratchpad/ui3Q/mtext.mjs`), so money reserves 7 ch; tokens 6 (7 hid them at
  360 px). At fit 0 and 1 the chips are right-aligned (`justify-content: flex-end`) so a new map
  title doesn't move them (a long one flips fit 0 → 1: at fit 0 only, chips jumped 111 px on pl). Button chips get a ≥ 44 px hit area by `::after` (insets count from the
  padding box: add the 1u border). The settings chunk is fetched on idle after a header with ⚙
  mounts and on the gear's pointerdown (first open 349 → ~270 ms at 4× in dev — the rest is
  the window's own mount).
  HUD pictures: `GxHud name="coin|token|key|rank"` — baked 12 × 12 `hud-*` (`paint.ts`
  `HUD_ART`: coin / token / pick are the `st-*` pixels, the key is upright brass, not the old
  water drop). GameTop sets `--hud` on itself = 1.4 em of the chip number (twice its cap height)
  snapped to whole device px per art px (24 px phone, 36 at ui-scale 4); mask icons in header
  chips take the same box. On phone portrait the chip gap is 1u and padding 2u/3u — the bigger
  pictures cost 12 px per chip and 360 px must still show money + tokens (340/340 at fit 3).
  New picture: add it to `HUD_ART`, re-bake (`npx vite-node scripts/ui-px/bake.ts`), restart the
  stand's Vite if it ignores `public/**` (a new PNG is otherwise the SPA's HTML). The wallet is a
  disclosure, not a dialog: `role="region"`, the chip has `aria-expanded` + `aria-controls`,
  focus stays on the chip (it closes on any outside tap).
- **Widgets:** `gx-btn` / `gx-round` → kit button frames via `--b/--bs/--bw` (gold default;
  iron for `--grey/--dark/--steel`; red; green; `:disabled` / `.is-off` ash), text colours
  `--gx-on-*` = the `.px-btn` face pairs. `gx-badge` → kit badge (1-art-px bob), `gx-bar` → kit
  trough (taller when it carries a label), `gx-chip` → kit well. Old sizes stay in px. Callers'
  `--gx-btn` URL overrides no longer do anything.
- **`KIcon` → kit icons** where a 9×9 exists (cross→x, arrows, checkmark→check, plus, minus,
  star, locked→lock, information→info, pause, gear, audioOn/Off→sound/mute, musicOn/Off→
  music/nomusic, question, exclamation→excl), sized to whole device pixels per art pixel; other
  names keep the Kenney mask.
- **Pitfalls:** `@keyframes gx-pop` (game-ui.css) and `gx-badge` (gx-px.css) are still used by
  old callers — don't delete them with their blocks. Settings' `.gx-modal__box:has(.gset)`
  760-px width is beaten by `.gx-win > .gx-win__box.px-panel`. Stand: the Vite watcher must not
  ignore `**/.claude/**` (a worktree lives under `.claude/`) — CSS edits looked dead.
- **Not verified:** a real phone / Telegram webview (safe areas in fullscreen, iOS hyphenation of
  long rail words), gamepad hardware (LB/RB/B checked through `emitAction` only). Stand checks:
  6 formats × ru/de (+tr for the rail), no page scroll, rects equal across all camp tabs,
  NestSheet inside a zoomed camp at 1920×1080.

## Camp tabs on the kit (wave 3 — T, 13.10.2026) — `CampTabs.tsx`, `camp-tabs.css`

Shop, Runes, Finds, Milestones, Skills left `PrisonCamp.tsx` for `components/CampTabs.tsx`
(PrisonCamp imports them back; the shared pictures are in `camp-art.tsx` since round 2 — see
stage B below). CSS lives in `camp-tabs.css`, scoped to `.ctab`; the old
`pshop-pack`, `prune-*`, `prunes-*`, `pamulet*`, `pfinds*`, `pmile`, `ppet-bar` blocks are
deleted. New strings are in the area `ctabs`. Prices, effects and confirmations are unchanged.

- **Layout = `ctab--one|land|tall|wide`** from `useFormFactor`. Body sizes measured in u:
  phone portrait 171×341, phone landscape 374×152, tablet portrait 163×217 (C's rail took about
  95u; since round 2 a top strip: 251×206), tablet landscape and desktop
  283–326×214. `tall` is therefore the compact variant: sockets 2×2 beside the pouch, small
  rune buttons (the skills reset sits on the points plate since round 2).
- **Shop:** rows with the price button on the right (phones, tablet portrait); a 3×2 grid of cards
  on wide. The pack size is a tag on the art's corner, and the price keeps 5ch, so ×1/×5/×10
  never resizes anything. Can't afford: an `off` button plus a floating pop with the shortfall.
- **Runes:** sockets as a row, 2×2, or a cross around the pick+axe core (wide). The inspect panel
  keeps a fixed skeleton; with nothing picked it shows a hidden stand-in rune. Actions: «socket»
  on its own row, fuse and shatter in two halves (tall uses fixed 5:4:3 shares). A locked socket
  caption breaks at min-content («престиж / 10»).
- **Finds:** a grid of Slots (silhouettes when not found), a showcase inspect panel on land/wide.
  **Milestones:** ready rows on top, done rows dimmed below. The order is frozen while the tab is
  open: a row you take stays in place, because its button and check share one grid cell.
- **Skills:** nodes wrap as wide as their names (no ellipsis). Now/next values come from
  multiplying the first number of the per-level text (`perkAt`; «blat» has no number).
- **Checks** (`{SCR}` = `scratchpad/ui3T`):
  - `jump.mjs` compares rects across selections, buys, claims and learns. Result: 0 px in ru/de
    on all 6 formats.
  - `clip.mjs` lists ellipsis, clipped text and button-label overflow. Run it for all 7 languages
    whenever labels change. German «Verschmelzen» did not fit, so the tab has its own short key
    `ctabs.runes.fuse` («Schmelzen»).
- **Input:** focus = selection for keyboard and gamepad only (`getInputDevice`); touch toggles.
  X / pad Y does one thing per tab:
  - Shop: cycles the pack size.
  - Runes: sockets the rune or takes it out.
  - Skills: learns.
  - Milestones: takes the top ready one. Its KeyHint is in the head, not in a button, so the next
    row's button never changes width.

  Pad focus moves are the actions `up/down/left/right`, not `move*`.
- **Round 2, stage A (T2 / T2′, 19.10.2026):**
  - **Short phone** (`useLay().short` = phone portrait with `h / scale < 350`, i.e. 320×568,
    iPhone SE in Telegram; body ≈146×213u): Skills take `tall` plus `ctab--short` (plate alone
    in the head, nodes as a sideways strip with a `›` while more lie beyond, no per-level line);
    Runes get `ctab--short` on `one`: sockets row (18u) + bonus 2×2 on top, pouch (2 columns) |
    inspect (name, 2-line effect, 1-line note with `data-tip`, three stacked `sm` buttons) side
    by side, no socket captions (a locked socket says its level when tapped). Before, the
    pouch and the skill tree were 0 px tall there.
  - **Skills reset** = `Button size="sm" icon="undo"` on the points plate, armed by a first tap,
    fired by a second ≥ `ARM_GUARD_MS` later (`useArmGuard`), disarms after 4 s or on any other
    action; «tap again» goes to the note line (`ctabs.perks.resetArm`). Phone landscape drops
    the per-level line and packs the panel at 1u so the note line keeps its 2 lines.
  - **Runes bonus** = the worn runes only (`bonusOf({ runes, sockets })` — pets show theirs in the
    Nursery), a fixed 2×2 grid of `[stat art 24] +7,5% продажа` chips (`ctabs.bonus.*`, full
    `camp.bonus.*` in `data-tip`). If any word would be cut, all words go (`.is-tight`, measured
    in a layout effect + ResizeObserver): words show at 342 px (pp) and up, not at 253–312.
  - Checks: `scratchpad/ui5T/stageA.mjs` (buttons vs body, reset arm timing, bonus box),
    `shots.mjs`, `armshot.mjs`, `strip.mjs`, `geo2.mjs`.
- **Round 2, stage B (T2′, 19.10.2026):**
  - **Pictures** (`TokenIcon`, `KeyIcon`, `ItemIcon`, `RuneIcon`, `RUNE_COLORS`, `runeLine`,
    `PetIcon`, `RewardIcon`, `rewardLabel`, `ParcelReveal`) live in `components/camp-art.tsx`;
    PrisonCamp re-exports them for old importers. CampTabs and BooksTab import camp-art, not
    PrisonCamp (no cycle). New code: import from camp-art.
  - **Clock:** the camp sheet has no `useNow`; `CampTabBar` (bench / crew badges) and
    `MillTab` / `BenchTab` / `CrewTab` tick themselves. All five kit tabs are `memo`.
  - **Tablet portrait:** the camp tabs are an icon strip on top (`vertical` false, `is-compact`,
    the ribbon names the tab); camp-tabs.css turns the chrome's rail grid back into a column for
    that case. Body 173×227u → 251×206u; window size unchanged; `lay` stays `tall`.
  - **Runes:** no % under filled sockets; locked caption on cream; a tapped locked socket shakes
    1u (320 ms) and the note says why (`lockedShort` on a short phone); shatter = `[hammer] +N ✦`,
    tier ≥ III arms first (`shatterArm`), a worn rune says `wornNoShatter`; wear / shatter
    guards; fuse 2fr : shatter 1fr; short phone: fuse notes `fuse*Short`, 2-line note.
  - **Skills:** level = kit digits on the slot corner (`count="l/max"`), the skill art 2× in the
    panel, one line `ctabs.perks.step` from `perkVal()` (the bare «+6%» of the text), 300-ms
    Learn guard, plate digits 1.15 × fs.
  - **Shop:** phones (`one`, `land`) show one effect chip `ctabs.shop.fx.<id>` (the sentence is
    its tip); phone portrait stacks name / chip / price beside the art (in one row the chip had
    65–110 px). Currency tokens 12u on phones, 28 px on tablet / desktop; the pack tag sits on
    the art's top-left. The pack bar has 2u under it (the button edge stuck 4 px out of the tab).
  - **Achievements:** `one` / `tall` row = art (the condition is its tip) | title + chips + bar |
    small claim beside the title; ≤ 3 chips (2 on a short phone) + «+N» with a tip; compact chips
    drop words (`ctabs.miles.socket`, `nursery.egg.*`, tier only). Short phone: a ready row puts
    the claim in the bar's place (`:has(.ctab-mile__swap)`). Done rows: sunken well frame +
    faded art, text stays. Rows 81–94 px on 360–430 phones (6–7 visible), 81–97 at 320/375.
    Opening renders 8 rows, the rest in a transition a frame later (`MILES_FIRST`) plus
    `content-visibility: auto`: second open 192 ms at 4× (dev; critic's 304).
  - **Finds:** `one` / `wide` = 4×3 sized by a ResizeObserver (a quarter of the width, a third of
    the height; `fitDown` keeps whole art multiples): 76–80-px slots with 64-px art (70 at 360),
    52/60 at 320/375, ≈ 111–120 on tablet / desktop (wide columns 3fr : 2fr). Inspect art 96 on
    phones with room, 48 on a short phone; on `one` the name runs over the whole panel (2 lines
    reserved on short / land / wide), the text takes 3 lines.
  - Checks (`scratchpad/ui5T`): `allfmt.mjs` (all tabs, buttons below the body, clipped text,
    scroll), `milesB.mjs`, `milerow.mjs`, `claim.mjs`, `findsB.mjs`, `findnames.mjs` (every find
    in 7 languages), `packshot.mjs`, `body.mjs`, `switch.mjs`, `perf.mjs`. Formats: p320, s375,
    p360, pp, p430, pl, tp, tl, d1 (`lib.mjs` SIZES).
- **Round 3 (T3, 19.10.2026, critic14 `critic-camp-tabs2.md`)** — supersedes round 2 where they
  differ:
  - **Measure-and-drop everywhere** (layout effect + ResizeObserver toggles `.is-tight`; the
    whole sentence stays the tip / aria-label). Runes inspect: «+4,6% чары» →
    the number alone (`.ctab-insp__gw`), the full `runeText` effect (2 lines) → the short
    `camp.bonus.*`; fuse line: `fuseGo` word, then the result's name (`.is-bare`; measured by
    a Range on the text — `scrollWidth` rounds a 1-px overrun away). Skills: «· за уровень»
    (`.ctab-insp__per`). Achievement chips: their words when a chip box would wrap past its
    lines (1; a ready row on tall / wide 2). Sweep 8 formats × 7 languages: no cut, 0 px drift.
  - **No text on stone:** empty sockets carry no caption (their name is the aria-label); a
    locked one with no rune keeps the cream plate (`.is-lock` only when the caption has text).
  - **Short-phone skills strip** = pages of whole nodes (`paginate()` packs `.ctab-node`
    widths greedily into `clientWidth − 2 × (arrow + gap)`) with real `Button size="sm"
    icon="left|right"` arrows (`ctabs.perks.prev/next`, `tabIndex -1`, hidden at the ends,
    hit area ±(7 px + 1u) via `::before` — the kit focus ring owns `::after`), `scroll-snap`
    mandatory + `snap-stop: always`; a tap scrolls one page (smooth unless reduced motion).
    320: 3 pages (de 4), no half node.
  - **Spare height goes to the picture** (`useShowBox(on)` measures the art box): skills art
    `--tile` 36–72u (pp 138 px, p430 144, tp 111, tl 144, d1 216; 72 on pl, 48 on a short phone
    with the level on its corner as on the node), finds art `fitDown(16, min(h, w, 192))` (pp
    187, p430 192, tp 112). Panels with `.is-show` stack picture / name / text / acts; blank
    under the panel content: finds pp 210 → 12 px, p430 318 → 12, tp 176 → 21; skills pp 165 →
    18, p430 273 → 18, tp 149 → 27.
  - **Achievements** use the compact row on every format; `land` / `tall` / `wide` lay rows in
    two columns; a ready row on tall / wide puts the claim beside two chip lines (bar hidden).
    Rows (7 languages): p320 81–104 px (3 visible), pp 68–94 (6), pl 81–94 (4), tp 94–99 (8; fr /
    tr / it one grid row 125 — a 2-line title beside), tl / d1 87–99 (10; were 103–256, 4); a
    claim moves no row.
  - **Amulet bonus = what the runes really add**: `bonusOf(p) − bonusOf(no runes)` per kind,
    sell as the ratio of `modsOf().sell` with / without runes (the +100% sell cap); a chip below
    its rune sum gets a red `excl` and the reason (`ctabs.runes.capTip` / `capSellTip`). Phone
    landscape titles the box `ctabs.runes.gives` («Оберег даёт»).
  - Minors: Blat step `ctabs.perks.blatStep` «Старт: ранг A → B» (`min(LAST_RANK − 1, lv)`, as
    store.ts), rune in the panel 30u, fuse plan in pictures (two runes → result, tip = the
    sentence; short phone keeps words), ×1/×5/×10 gap 4u, purse counts up (400 ms, 12 steps,
    `min-width` of the final value; reduced motion jumps), shatter token 24 px.
  - Checks (`scratchpad/ui6T`): `sweep.mjs fmts langs [tabs]`, `strip2.mjs`, `milesw2.mjs`,
    `capshot.mjs` (runes over the sell cap), `purse.mjs`, `cutprobe.mjs fmt lang text`,
    `shots.mjs` + `sheet.py`, `blank.mjs`, `press.mjs` (pp at 4× CPU: first changed frame 20–31
    ms on every control). `allfmt.mjs` flags `TAB-OVF 4` on p320 runes and `OFF-X 3` on
    the short-phone skills: the first is the bottom button's invisible focus ring (`inset −3u`)
    past the tab, the second the strip's other pages — neither scrolls or shows.
- **Pitfalls:**
  - The kit `Grid` prop `slot` clashes with the HTML `slot` attribute type: pass
    `style={{ '--slot': … }}` instead.
  - The camp sheet's `b/strong/h3` weight rule hits real headings, so the tabs use spans.
  - After HMR the app imports `/src/store.ts?t=…`. A stand script must import that same URL (take
    it from `performance.getEntriesByType('resource')`), otherwise it writes into a second store.
