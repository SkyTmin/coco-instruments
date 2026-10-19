---
paths:
  - "src/components/{ForgeScreen,PickArt,MineField,Inventory}.tsx"
  - "src/components/{armory.ts,armory.css,forge.css,backpack.css}"
  - "src/lib/{crack-stages,rarity}.ts"
---

<!-- Перенесено из CLAUDE.md дословно (v2.87): грузится, только когда
     открыт файл из `paths`. Тема: Кузница, кирки, разлом, поле шахты. -->

## Кузница v2.67 — сила кирки, твёрдость руды, редкость (ЧИТАТЬ про кирку)

Владелец: «для перехода всего по одному цельному блоку — мало», «лагерь,
улучшение кирки, заказ — ужасно, непонятно, отталкивающе; возьми пример у
популярной игры», «нахер кирке урон», «чем круче кирка, тем ярче —
легендарная, не легендарная». Решения по плану (`docs/plan-kuznica-2026-09.md`):
твёрдость руды — да, круг A→Z — 4–5 ч у идеального игрока.

- **Кирка называется по руде, ИЗ которой куётся, и открывает следующие
  этажи** (Майнкрафт, Terraria): Железная — из железа на G, берёт H–I
  (кобальт). Ворота этажей — D, F, H, …, X, Y, Z; кирка №N куётся на своём
  этаже-материале (`floor`) и нужна для `floor + 1`. `rockHardness`,
  `pickPower`, `canMine`, `minPickFor`, `opensRocks` — в `prison.ts`.
- **Твёрдость — УСЛОВИЕ РАНГА, а не «после ранга поле звенит».** Так было в
  плане, и так делать нельзя: шахта — яма, твёрдый верхний блок закрывает
  всё под собой, и новый этаж без кирки выкапывался бы на ~16%, после чего
  игрок уходил бы на этаж назад. Поэтому ранг просит кирку под следующий
  этаж (`rankNeeds().pickOk`), а «звенит» руда следующего этажа на ДНЕ
  (`NEXT_ROCK_CHANCE` 5%): она ничего под собой не закрывает и показывает,
  за какой киркой идти. Тест «руда следующего этажа звенит только на дне».
- **Звон — в `useMineDig`, а не в странице**: `DigRules.hard(c)` возвращает
  нужную силу, удар по такой клетке — звон, искры, «⛏N» и `onHard`;
  `breakCells` и Трещина твёрдые клетки пропускают. Стор тоже не ломает
  руду твёрже кирки (`prisonBreak`) — не полагаемся на честность страницы.
- **Урона и заточки нет для игрока.** У кирки «Сила ⛏» и «Скорость»
  (`pickSpeed` — блоков в минуту на удержании по составу ЭТОГО этажа,
  только ударами: взрывы и жилы — случай, а не скорость). `dmg` остался
  внутренним числом. Чара «Сила» переименована в «Эффективность» (id тот
  же, `power`), Уруз и росомаха — «к скорости копки», Райдо и оленёнок —
  «к частоте ударов». Слово «урон» у кирки не возвращать.
- **Заказа кузнице больше нет — есть ЯЩИК КУЗНЕЦА** (`forgeBox`). Руда
  следующей кирки не продаётся: продажа руками и вагонетка сперва кладут её
  в ящик (`reserveOre`, `stash(..., {box, pick})`), в спецзоне руда идёт в
  ящик прямо из-под кирки (`feedBox`). Выковка (`prisonForge`) берёт сперва
  из ящика, потом из рюкзака; монеты — в момент выковки. Цена на кнопке
  «Продать» — БЕЗ руды для кирки; если в рюкзаке только она — «В ящик».
- **Старые сохранения:** оплаченный заказ v2.66 переезжает в ящик и
  помечается `forgePaid` (монеты второй раз не берутся); кирка ниже
  нужной этажу поднимается до `minPickFor(rank)` — иначе поле встало бы
  стеной. Полного сброса («Нового срока») НЕ было.
- **Редкость — `lib/rarity.ts`**, одна лестница на кирки (потом книги,
  топоры): Обычная (Ржавая–Кованая) → Необычная → Редкая → Эпическая →
  Легендарная (Алмазная, Звёздная) → Мифическая → Божественная
  (Александритовая). Эффекты `PickArt` по ступеням: свечение → блик (полоса,
  обрезанная силуэтом самой кирки маской `--pkimg`) → искры → лучи
  (`repeating-conic-gradient`, крутится трансформом) → аура → столб света.
  Эпическая и выше сыплет искрами цвета редкости с каждого удара в шахте
  (`DigRules.spark`).
- **Кузница — отдельный экран** (`components/ForgeScreen.tsx`): кирка на
  пьедестале, три цифры (Сила, блоков/мин, уровень), рецепт слотами как на
  кузнечном столе Майнкрафта (кирка + руда + руда → новая), лестница всех
  17 кирок силуэтами, внизу рюкзак и вагонетка. Кнопка «Выковать» не
  дизейблится насмерть: `aria-disabled`, а тап объясняет, чего не хватает.
- **Сцена выковки** (`ForgeReveal`): три удара молота (у легендарной
  медленнее), искры третьего удара — цвета редкости, вспышка, силуэт,
  проявление. Фон сцены НЕПРОЗРАЧНЫЙ: кузница под ней уже показывает новую
  кирку, и полупрозрачный фон выдавал, что выпало, до вспышки. Наковальня
  рисуется только в фазах удара и вспышки — иначе она висела под силуэтом.
- **Лагерь → нижняя панель** шахты: Кузница · Чары · Сундуки · Питомцы ·
  Ещё. Панель открывает `PrisonCamp` с `only` и `title` (одна вкладка — без
  ряда вкладок); «Ещё» — рабочие, руны, лавка, коллекция, достижения,
  навыки. Строка пород под полем убрана (цены — в окне «Этажи», там же
  «⛏N» у каждого этажа). Высота под полем — см. «Шахта v2.67.2» ниже
  (406/460 из этой версии сжимали поле до 32–36 px клетки).
- **Блоки этажа 3/5/7/10** (E–I, J–O, P–T, U–Y), докупка втрое дороже,
  попадаются раз в минуту копания: `blocksPerField = 315 / (60·BPS)`, где
  `BPS` — блоков в секунду идеального игрока по этажам (печатает `TUNE`).
  **Гарантия:** `blockPity(floor)` — две минуты копания своего этажа без
  блока, и блок встаёт на верх случайной клетки с рудой этажа
  (`mine.bonus`, `pityCell`, все блоки поля — `mineBlocks`). Живёт с полем:
  новая шахта — гарантии нет.
- **Темп — 4,8 ч у идеального игрока** (по зёрнам 4,4–5,0; было 1,7).
  Цены рангов и выработка — от `TUNE=1 … -t подгонка` с целью `TARGET_MIN`
  (A 1,3 мин → Y 17 мин) и `LAG=0.9`; чары дороже в 2,5 раза
  (`ENCHANT_PRICE`), уровни кирки реже (`PICK_XP` 200) — иначе длинный круг
  докачивал чары к середине, и поздние этажи пролетались. Престиж —
  900 тыс., кирки спецзоны — 400/600/900 тыс. («без миллионов» соблюдено).
  Грабля: без условия «цены только растут» подгонка делала ранги с
  выковкой ДЕШЕВЛЕ соседних (пила цен) — в `TUNE` стоит монотонность.
- Лес пока не пересчитан под новый масштаб цен (тест «последний разряд
  соразмерен…» ослаблен до `rankCost(12)`) — это выпуск инструментов.
- **Стенд:** после ЛЮБОЙ правки `store.ts`/`lib` скрипт стенда пишет в
  другой экземпляр стора — перезапускайте Vite. Убивать его — по номеру из
  листинга `/proc`, отдельной командой: цикл, в котором есть строка «vite»,
  убил собственную оболочку в третий раз.

### Кирки v2.69 — HD-рендер и кирка в руке

Владелец: «какая-то школьная картинка у кирок, выглядят будто 144p, а не
4К», «чем отличается ржавая кирка от железной?», «добавь возможность
переключаться между кирками».

- **Pick images are code-drawn pixel strips since the pixel-props round** (set `picks`:
  `icon-<i>`, `spin-<i>`, `forge-r<r>`; drawer `src/lib/props-pixel/picks.ts`). The v2.69 3D
  renders (`public/ui/picks/v2`, `scripts/picks-render`) were removed. Details, API, pitfalls —
  `.claude/rules/props-picks.md`.
- **Каждая кирка — свой материал, а форма растёт с редкостью.** Ржавая —
  изъеденное железо с рыжими пятнами и сбитыми остриями; Каменная —
  кремень со сколами на верёвочной обвязке; Кованая — тёмная сталь во
  вмятинах от молота; Железная — полированная сталь; Бирюзовая, Лазуритовая,
  Родонитовая — полированный камень с прожилками/крапом; Кварц, гранат,
  сапфир, рубин, алмаз — гранёный самоцвет; Опал — молочный с игрой цвета;
  Звёздная — тёмная сталь со светящейся россыпью; Чароит — волокнистые
  завитки; Александрит — от зелёного к малиновому. С редкой — кольца обуха,
  с эпической — самоцвет на обухе, с легендарной — самоцвет в навершии;
  рукоять темнеет от сосны к чёрному дереву. Самоцветам слабый лак:
  сильный белил их до пастели.
- **Кирка в руке и лучшая выкованная — разные поля** (`pick`, `pickMax`).
  Любую выкованную можно взять в руку тапом по ней на лестнице кузницы
  (`prisonEquip`), у той, что в руке, метка «в руке». От ЛУЧШЕЙ — кузница
  (`nextPick`, `forgeCheck`), условие ранга (`rankNeeds`), достижение; от
  той, что В РУКЕ, — удар, скорость, твёрдость руды, искры. Держишь слабую —
  твёрдая руда звенит, и подсказка говорит «возьми в руку …», а не «выкуй».
  Старое сохранение: `pickMax` = прежний `pick`, поднятый до этажа.

### Разлом как в Майнкрафте (v2.68.0) — `lib/crack-stages.ts`

Владелец: «анимация ломания ужасная. Если блок ломается за два удара,
анимация должна быть из двух кадров, если за три — из трёх… Как в
Майнкрафте! Там приятная, плавная анимация».

- **Стадий десять, как `destroy_stage_0…9`, и стадия — доля урона ×10**
  (`crackStageOf`, `crackStage` в MineField — то же). Урон делится поровну,
  так что у блока на N ≤ 10 ударов каждый удар до разлома даёт свою
  стадию: два удара — полсети и разлом, три — треть, две трети и разлом.
  Было три стадии, и при двух ударах первая пропускалась. Тест «сколько
  ударов, столько кадров».
- **Одна сеть трещин на рисунок**, стадия k открывает её до «времени» k —
  каждая следующая содержит прошлую (тест). **Линии — в один пиксель.**
  Пробовал главные ветки в два у точки удара, владелец вернул: «тонкие
  линии мне очень нравились, больше чем толстые» (v2.68.1). С шестой
  стадии — вмятина в шахматку у точки удара. Восемь рисунков, выбор —
  `crackVariant` от зерна шахты.
- **Рост плавный**: клетка держит ленту всех стадий (`crackStrip`, 32×320)
  и показывает стадию сдвигом трансформом; между ударами стадии от прошлой
  до новой пробегают ступеньками (`steps`) за 60–150 мс. Без перерисовки.
- **Разлом — куски, а не «проступание»**: `shatter` режет торец на четыре
  четверти его же картинки, они подпрыгивают к камере и падают в яму —
  как частицы блока в Майнкрафте. Звать ДО того, как клетка покажет ярус
  ниже (картинку берут с торца). Прежний `rise` (ярус ниже вырастал из
  0,72) при разломе снят: блок исчезал в один кадр, а новый выпрыгивал
  навстречу. Остался для гарантийного блока этажа. В пачках кусков — до
  десяти клеток, слой не больше 48 узлов.
- Лес берёт ту же ленту плиткой по длине бревна.
- **Полоса через всё поле на iPhone (v2.68.1).** Между 5-м и 6-м рядом шла
  тёмная линия. Причина — `scale` на торце: даже `scale: 1` делает его
  трансформированным, а такой элемент Safari не выравнивает по пикселям
  экрана и сглаживает края. Клетка была дробной (55,7 px), граница рядов
  5/6 при ×3 падала на полпикселя (835,5), и сквозь полупрозрачные края
  просвечивало чёрное дно ямы. Chrome края выравнивает — на стенде полосы
  нет, и проверить можно только на телефоне. Лечение: у нетронутого блока
  (`.pcell.is-top`) `scale: none`, а клетка шахты — в целых пикселях через
  `round()` под `@supports`. **Не ставьте торцу верхнего яруса ни
  `scale`, ни `transform` в покое.**
- **Готовых стадий под нашу лицензию нет — искали.** Текстуры
  Майнкрафта — Mojang; Luanti `crack_anylength.png` — CC BY-SA 3.0 (правило
  репо — только CC0/CC BY); Terasology `effects.png` — десять стадий, но
  лежит строкой, как старый `terrain.png`, файл 2011 года, а в их Credits
  сказано, что часть базовых текстур из пака для Майнкрафта Good Morning
  Craft — происхождение не доказать; ProgrammerArt (deathcap, CC BY 4.0) —
  чистые, но это сетка крестиков; у Kenney трещин нет. Найдёте чистый
  CC0/CC BY набор лучше — меняйте `crackStagePixels`, остальное не трогая.

### Шахта v2.67.2 — широкое поле, трещины, ржавая кирка

Владелец: «экран стал слишком узким», «разломы руд сделай разными, а то у
нас только один разлом посередине», «ржавая кирка прям сливается с блоками
первого этажа».

- **Клетку шахты ограничивает ВЫСОТА, а не ширина.** 7×9 клеток: всё, что
  стоит над полем и под ним, делится на девять. Нижняя панель v2.67 добавила
  70 px, и на 430×805 с заданием клетка упала до 36 px — поле в две трети
  ширины. Вернули: одна строка сверху (назад · монеты · токены · этаж ·
  лес · ⚙) вместо ленты с названием и ряда фишек, ниже полоса ранга,
  расходники, рюкзак, панель, задание одной строкой, зазоры 6 px. Всё под
  `.pmx--mine` — лес и рыбалка носят тот же каркас `.pmx` и не тронуты.
  `--below` 300 px, с заданием 345 — замер на 430×805, 390×750, 375×667,
  412×915. Клетка на 430×805 с заданием — 51 px (было 36), без — упирается
  в ширину. **Добавили строку над полем или под ним — перемерьте `--below`
  скриптом, иначе поле уйдёт под край.**
- **Этаж — фишка с его рудой**, тап открывает окно этажей (название этажа
  там). Монеты в шапке с 100 тыс. — «123,4к», с миллиона — «12,3м», как
  токены рядом: «999 999» на 375 px в строку не влезает (`chipMoney`,
  `MoneyCounter format`).
- **Трещины — восемь рисунков** (`crackTexture(stage, variant)`,
  `crackVariant(seed, cell, depth)`): раскол надвое из случайной точки,
  звезда от точки удара, скол от края, зигзаг с мелкими ветками — по два
  рисунка на вид. Ветви одни и те же на всех стадиях, растёт только длина:
  трещина растёт, а не подменяется. Рисунок клетки — от зерна шахты, так
  что у соседей разный, а при перезаходе тот же. Лес берёт рисунок по
  срубленному бревну.
- **Ржавая кирка** — тёмная обводка и светлый кант в самой картинке
  (`scripts/picks-assets.py`, `outlined`) плюс статичный светлый ореол
  `drop-shadow` у обычной и необычной (`.ppick-ico:is(.r0,.r1)`): у
  редких и выше свечение цвета редкости уже есть. Головка ржавой темнее
  (`#8c4a2e`), железной — стальная, а не рыжая.

### UI v2 — the armory skeleton: forge and backpack (wave 2 — F, 13.10.2026)

Files: `components/armory.ts` + `armory.css` (shared by `ForgeScreen`, `Inventory`, `BooksTab`),
`forge.css`, `backpack.css`. Logic, costs, confirmations and scenes (`ForgeReveal`, `PickArt`,
`PxStrip`) are unchanged — only the layout is the kit's.

- **Layouts** — `useArmLayout()`: `one` phone portrait (top / showcase 13fr / list 7fr / action
  bar), `two` tablet portrait (showcase 13fr over list | side 7fr), `three` landscape, tablet
  landscape, desktop (list | showcase | side = 6fr 15fr 6fr). The page never scrolls; the list
  and the side column scroll inside. Measured showcase share (bbox script): forge/backpack
  54 % of the height on 390×844, 58 % on 820×1180, 52–53 % of the width elsewhere.
- **Showcase** `.arm-show` (size container `arm-show`) → `Panel stone stage` `.arm-stage`:
  `.arm-room` (`contain: size`, measured by `useBox`) / `.arm-id` ink plate with `.px-dark`
  (90 % ink + ink border: rarity colours ≥ 6:1) / `.arm-stats` (three fixed cells, big tabular
  numbers, green/red deltas vs the pick in hand). Art size `heroFit(box, u, max, pedOf)`:
  `heroSize` alone ignored the 3 pedestal pixels under the art and the art ran 9 px into the plate.
- **Plate beside or under the art** — by the showcase's own aspect:
  `@container arm-show (aspect-ratio > 23 / 20)` → beside (phone landscape, books on tablet
  portrait); otherwise stacked. Since the showcase got half the screen, stacked is the bigger
  art for picks and items on phone portrait (forge 390×844: 202 px against 180 beside).
- **Name fits by its longest word**: `--nfs` per format, font-size
  `max(fs-sm, min(--nfs, 100cqi / (--wlen × 0.66)))`, `--wlen` from `nameFit(name)`, `.arm-id`
  is an inline-size container; two lines reserved. «Goldspitzhacke» / «Эффективность» no longer
  break inside the word. The side column's `.arm-info__name` is `--px-fs` (the plate names the
  thing big already; hidden on phone landscape).
- **Nothing jumps** (owner): stat number row fixed at `1.25 × fs-big` (a delta baseline-aligned to
  an icon grew the row 2 px on some picks); two reserved lines for name, state, effect and stat
  labels; the action bar is a row of FIXED places (absent action = `visibility: hidden`
  placeholder), buttons 26u high with two-line labels. Check: `{SCR}/bbox.mjs <forge|inv|bunk|books>
  [formats]` clicks every slot and prints the drift of showcase, room, pedestal, plate, name,
  stats, each button, list and side — 0 px on all six formats.
- **Forge**: picks grid = kit `Slot`s (★ corner, power count, silhouettes for not forged); side =
  rarity pill, what it mines, level bar (wraps on a narrow column), enchantments as name over
  effect (side by side the effect squeezed the name to nothing). Compare tooltip on slots.
- **Backpack** (`Inventory.tsx`): sections as kit `Tabs` (icon + count badge, one scrolling row on
  phones incl. landscape, wrapped elsewhere), sort by rarity, slots with a where-from corner mark
  and «!»; rarity per item `rarityOfIcon` (ore/block → the pick that opens it, book → tier, egg,
  rune tier, parcel). A sold/moved item stays in the showcase as a ghost (count 0, no actions).
  Action places per place `ACT_SLOTS` (bunk 4, mine 1, yard 1, view 0 = hint line). Bunk chest:
  9 columns of kit slots, the locked big chest says what unlocks it. X = the first confirm action
  (selling in the mine is one tap, as before).
- **Kit pitfalls**: rules inside `@container` don't gain specificity — base rules later in the
  file won (prefix them with `.arm-stage`). `.arm-details` needs `grid-template-columns:
  minmax(0, 1fr)`: an auto column grew to the widest row and the side panel scrolled sideways,
  cutting words. `.arm .rchip` is restyled as the kit pill (ink on `--rc`) — the old chip read
  1.4:1 on the light panels.
- **Critic pass** (`armory.ts`/`.css`): `useFirstFrame()` — the window paints first, the slot grid
  a frame later (open 400–600 → 110–220 ms at 4× CPU); `numFit(s)` + container `arm-stat` fits a
  long stat number into its cell (`--nlen`, cqi); a greyed action button gets `.px-dark` (kit ash
  label is 2.9:1 → cream 4.6:1); the action bar clips with `clip-path: inset(-3u)`, not
  `overflow: hidden` (that ate the kit focus ring); words wrap, coin / icon / key cap are
  `flex: none`, a button with `.arm-btn-price` wraps the price under the words (small size on
  phone landscape); text icons are `max(8u, 1em)`; the camp's bold rule skips `.px *` (Coco Title
  has one weight — it was fake-bolded).
- Old CSS removed (`.fg*` in `game-ui.css`, the old `.inv*` layout in `inventory.css`) by
  `{SCR}/cleancss.py`: a rule goes when its scoped class is in no `src/**/*.ts*`; template
  prefixes (`mcinv__set`, `inv-px`, `pench-bulk__b`, `fgr`) protected.
- **Critic round 2** (13.10, `critic-armory.md`; forge, backpack, books, bunk chest):
  - `.arm-list` is one `minmax(0, 1fr)` column — the forge's 17-pick strip scrolls inside
    `.frg-grid`, not the whole list (992 px in a 374-px list).
  - Phone landscape stage: the art takes the full stage height on the left, the plate and the
    stats (number · delta, the label under them — see below) stack on the right.
  - Plate: name on one line shrinking by its whole length (`--nlen` from `nameFit`; beside the
    art by the longest word `--wlen`), `overflow-wrap: normal; hyphens: auto` — no breaks inside
    a word. Fixed heights for name, state and effect.
  - Touch: a second tap on the selected slot does nothing — keys act (`fromKeys(e)` =
    `e.detail === 0`), fingers use the action button. Two-tap confirms ignore a tap < 400 ms after
    arming (`useArmGuard`, `ARM_GUARD_MS`).
  - `useFullWin(on, scene)` → `html[data-fullwin]` (and `data-fullscene` for a scene): `.pmx` and,
    under a scene, `.gx-win` get `visibility: hidden`; `.arm.is-window` / `.arm-scn` set
    `visible` back (a scene may live inside the camp). `predecodeArmory(pick)` runs from
    `PrisonPage` in `requestIdleCallback`: kit frame PNGs (read from `--pxk-*` on `:root`), the
    pick spin, pick icons, book idle strips, ore icons — 4 at a time.
  - `content-visibility: auto` on list sections after the first, with `padding: 3u; margin:
    -3u` — its paint containment clipped the focus rings and corner badges.
  - Result scenes `.arm-scn` (`ForgeReveal`, `RevealScene`, `ApplyScene`): the dark backdrop is
    `::before` and fades at `.is-lit` to the kit veil; a parchment card (`.arm-scn__card`, frame
    on its `::before`, so it fades in without moving anything) holds the art and the text;
    lines `--px-fs-sm`, name `--px-fs-big` with an ink outline, CTA = kit primary `Button`
    (`--gx-hit` high, `data-autofocus`, root `data-ui-layer`). Phone landscape: art beside text.
  - Backpack: «Всё» is one grid with a marker cell per section (`SecMark`: section icon + bar of
    its first limit, tap = that tab) instead of heading lines; tabs are 44×44 icon tabs that wrap
    on phones, the count in ink on a well frame at the corner (positioned against `.px-tab`: the
    kit label clips). Bunk chest: kit-size cells `repeat(auto-fill, --slot)`; action places —
    see below. Tooltip icons 24 px, rarity as the kit pill.
  - Phone portrait forge list: the 17-pick strip first, the 72u details under it — details first
    left 0 of 17 picks on screen at 360×800. Stat number line-height = its row (1.15): at 1 a
    tablet's 1em icon stuck 3 px out. Phone-landscape backpack tabs: `grid-auto-columns:
    max-content` (an auto track shrank to the kit label's `min-width: 0` and cut «Alles»).
  - `useWordFit(root)` (all three screens): a stat label, a forge ingredient or enchant name
    whose word would split over two lines gets `data-tight` — one kit step smaller (label → tiny,
    name → sm). MutationObserver + ResizeObserver, so it runs before paint; break points are
    space, ZWSP, hyphen and slash. Was «Состояние», «Buchplätze», «Chance», «Kazmadaki»,
    «Granatspitzhacke» split on 360 px and in phone landscape.
  - Phone-landscape stats: number · delta on one line, the label one nowrap line under them
    (`'num delta' 1.15fs / 'lbl lbl' fs-sm`, padding-block 0 — 44 px a stat: the books' three
    stats under a three-part plate have exactly 136 px). Beside the number the label had 45–62 px.
  - Bunk chest: the phone bar has as many places as actions; a side column keeps `ACT_SLOTS`
    places (spare ones hidden above the buttons) — fewer places moved the details by 58–87 px.
- **Not verified**: a real phone / Telegram webview, hyphenation (the stand's Linux Chromium has no
  dictionaries — `hyphens: auto` is for phones), gamepad hardware (actions emitted on the bus).

### F4 — handoff layout (19.10)

Owner 19.10: «кузница слишком светлая», «не сочетается цвета шрифтов», «не нравятся длинные
прямоугольники» → the ChatGPT handoff LAYOUT in our pixel style on a dark palette. Binding target:
`{SCR}/shapes/index.html?p=slate` (`&s=gear`). `armory.ts` / `armory.css` are untouched (backpack
and books did not move); the old `forge.css` is replaced whole.

- **Dark kit** `src/ui-px/dark.{css,tsx}` + pure `dark-art.ts` (test `dark-art.test.ts`: centre =
  fill, stretched edges uniform, the slices declared in `dark.css` = the pictures). The palette is
  ONE `.pxd` token block in `dark.css` (А «Ночная шахта» now; Б «Малахит» / В «Аметист» values in
  the comment above it — switching is one edit). Frames are SVG 9-slices drawn at runtime from the
  tokens (`usePxd()` → `<style id="pxd-frames">`, `--pxd-f-*`): panel / sel / well / oct (cut 2 / 2 /
  1 / 6), act (cut 3 + a 2-px slab; pressed = the face 2 px lower by swapping border widths), off,
  ribbon (3-slice, 21 art px). The LAYOUT border is only the ring (2u), `border-image-width` the
  whole slice, so content may sit over the corner fill. Pieces: `.pxd-f--*`, `.pxd-btn`,
  `.pxd-chip`, `PxdButton` (`frame`, `off` = aria-disabled and still explains on tap, `hint`),
  `PxdRibbon` (`--rc` name with a 1-art-px ink outline), `PxdPips`, `PxdSocket` (`d` 12/14/16/20),
  `PxdGem`, `PxdPedestal`, `PxdSheet` (portal, escape stack, own `data-ui-layer`, docked on
  phones). Type `--pd-fs-*` = px × (0.7 + 0.15·ui-scale) × the text setting. Books and Nursery go
  on it next; the light kit is unchanged.
- **Colours**: text / muted / accent, ok for statuses, rarity only on the ribbon name. Contrast
  (`{SCR}/ui8F/contrast2.py`): text on bg / panel / well / off 15.3 / 11.4 / 13.7 / 8.6; muted
  8.5 / 6.3 / 7.7 / 4.8; accent on panel 8.6; ok 8.2; CTA ink on gold 11.0; ticks 12.3 / 12.9;
  rarity vs its outline 6.2–14.0 (on the bare ribbon 2.8–6.2 — never drop the outline). Numbers
  ≥ 7: the level tile's «into / need» is body colour (muted on panel is 6.3).
- **Phone portrait** (`frg--one`, a flex column): header grid back | title · purse with the purpose
  line under both (it never gets cut); two tabs (`switchTab`, tabPrev/tabNext); the octagon stage
  (art `fitPick` = whole device px per art px of the icon strip, `PxdPedestal`), «N / 17» badge,
  ribbon over the stage's bottom (−15u), a fixed state row («✓ В руке», «Можно выковать», «Закрыта»
  + rank, or «Взять в руку» for a forged pick — so the CTA always forges); three square stats
  (power · blocks a minute · level with 10 pips and into/need; other picks show the forge floor;
  deltas vs the pick in hand); «Берёт» ore chips (gem + name, shrink by `--clen`) and «Чары»
  sockets by `enchSlots` + names + › (`onBooks`: PrisonPage closes the forge and opens `enchant`)
  share one key column (subgrid). «Коллекция · N из 17»: four picks (window `win`, stable on row
  taps, recentred from the sheet / after forging) + «Все» → `PxdSheet` with all 17. Bar: «Рецепт»
  square (sheet: last pick + ores = coins + next) + CTA «Выковать <name>» (`pickToForge` in
  `data-mine.ts`: ru accusative, tr «-yı», fr/es/it sentence case) with price / reason on line 2.
- **Short phones**: `@media (max-height: 700px)` (360×640) and `(max-height: 600px)` (320×568)
  take art pixels off every row (stats without pictures, 2u gaps, bar 24u). A narrow «Чары» line
  (`frg-side` < 330 px with ≥ 3 sockets, < 420 px with ≥ 5) hides the names (tooltip + aria keep
  them). The «Все» cell drops the noun under 66 px (`frg-all` container).
- **Wide**: tablet portrait `frg--two` = top / main 13fr / lines | full grid 6fr / bar; landscape
  and desktop `frg--three` = list | main | side 6 / 15 / 7 fr, side = stacked lines + a recipe row +
  a full-width CTA (the name may wrap). Gear tab: two tall cards (bag: capacity now → next, 13
  pips, «Улучшить» + price; cart: «Купить» for 5 000 tokens / done) + «Ящик кузнеца» (ore tiles
  have / need ✓ and why); wide = cards | box, tablet portrait = cards over box.
- **Measured** (stand, ru, mid save; art px / main column share): 320×568@2 112 / 50 % of the
  height, 360×640@3 112 / 50 %, 390×844@3 187 / 52 %, 430×932@3 261 / 56 %, 844×390@3 149 / 51 %
  of the width, 820×1180@2 280 / 54 % of the height, 1440×900 336 / 51 % of the width. No page
  scroll, no clipped text at 320 in de / tr / fr.
- **Nothing jumps**: `{SCR}/ui8F/drift.mjs <fmts> <lang>` clicks 9 picks (row + sheet) or 7 (side
  grid), then gear → picks; 31 / 42 blocks, drift 0 px on p320 p360 pp p430 pl tp tl d1. Pitfalls
  found: a centred flex child's box follows its content — stretch fixed rows (`align-self:
  stretch`), give the badge a `ch` min-width; `useBox(ref, on)` needs `on = tab === 'picks'`, else
  the observer of the unmounted stage reports 0 and the art vanishes after a tab switch; grid
  tiles `min-height: 0; overflow: hidden`, else a two-line label grows the row by 2 px.
- **Not verified**: a real phone / Telegram webview, gamepad hardware.

### F5 — critic round 1 (19.10, `critic-forge.md`)

- **Tap shield inside `PxdSheet`**: `shieldOnOpen()` / `shieldOnClose()` from `lib/tap-shield.ts`
  in a layout effect (300 ms after open, 350 after close). Every dark sheet gets it — no second
  mechanism. Double tap 90/200 ms over a sheet: 0 forges, 0 recipe opens. A second
  «Улучшить» within 400 ms is ignored (a double tap bought two levels).
- **Type = the main kit's scale**: `--pd-fs-xs/sm/fs/lg/xl` = `--px-fs-tiny/sm/px-fs/head/big`
  (phones 14/17/20/23/26). xs only for badge glyphs. No free `min()` shrink: the fit pass picks a
  whole kit step.
- **Fit pass** (one `useLayoutEffect` in `ForgeScreen`; canvas `textW`, probe `fsOf`; it toggles
  classes React doesn't own, re-runs on ResizeObserver and `fonts.ready`):
  - header `is-subrow` (the purpose line on its own row);
  - tabs `is-tight` (no icons);
  - ribbon `--frg-nfs`;
  - CTA `data-fit`:
    - phones: 0 / 1 sm / 2 bare verb / 3 reason only;
    - side column: `i` no hammer / `i2` / `i3`;
  - «Чары» k names + «+N»;
  - stat `is-short` («Blöcke/Min.» with a ZWSP after the slash);
  - level `is-tight` (width or height);
  - gear `--frg-art`;
  - R73 list columns (+1 column when under 15 % or over 85 % of the cut row shows; measured as at
    scrollTop 0 — else selecting a low pick re-flowed the grid).
- **«Берёт»**: the rows of all 17 picks are stacked (`grid-area: 1/1`), only the selected one is
  visible, so the line keeps the tallest row's height (2 rows where some pick needs them) and
  nothing jumps. `forge.takesAll` chip for picks with no new ore, and a `forge.takesTip` tip on
  the key (hover and tap).
- **Recipe sheet**:
  - tiles are the box's 50u squares;
  - the result's frame is painted in the rarity colour (`::after` over the frame ring);
  - a tile grows taller rather than letting text out;
  - `syl()` puts soft hyphens at syllable breaks — «Гранато-вая», not «Гранатова-я», because the
    stand has no hyphenation dictionaries;
  - `@container frg-rec (width < 340px)` gives two rows on 320/360: `[pick] + [ore][ore]` /
    `[coins] = [result]`.
- **Gear cards (phones)**:
  - `.frg-card__pic` is a size container taking the free height; the octagon is
    `min(100cqw − 2u, 100cqh, --frg-art)`, i.e. both cards get the smaller square;
  - pic `max-height` = card width, so tall phones spread the rest over the gaps;
  - ≤ 600 px high: no description line.
  - Measured:
    - pp: art 162, icon 108, max gap 25;
    - p430: art 182, icon 122, max gap 47;
    - 320: no overflow in any of the 7 languages.
- **Short phones**:
  - `@media (max-height: 700px)` and `(600px)` blocks tighten rows; the stage inset is 2u;
  - «N / 17» goes into the «Все» tile.
  - Pick sizes:
    - 320: ru 112, de/fr/it 96 (the purpose line on its own row);
    - pp 186.67;
    - p430 298.67 (was 261: the «Берёт» line is one row there now).
- Wide: «Рецепт» is a square beside the CTA (it was a 7.2:1 strip).
- Checks: drift 0 px on all 8 formats.
- Sweep leftovers:
  - the h1 range rect is 2 px taller than its 24-px row on short phones: the content area of
    Coco Title; nothing clips;
  - the ribbon steps per pick (SIZE-JUMP pxd-ribbon) are by design.
- **Not verified**: a real phone / Telegram webview, hyphenation by phone dictionaries.
