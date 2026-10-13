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
