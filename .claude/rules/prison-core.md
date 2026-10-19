---
paths:
  - 'src/lib/{prison,prison-art,prison-fx,totem}.ts'
  - 'src/pages/PrisonPage.tsx'
  - 'src/components/PrisonCamp.tsx'
  - 'src/lib/{prison,zone}.test.ts'
---

<!-- Перенесено из CLAUDE.md дословно (v2.87): грузится, только когда
     открыт файл из `paths`. Тема: «Каторга» (присон): шахта, смена, добыча, руны, срок, сундуки v2.57. -->

## «Каторга» — присон с видом сверху (v2.46.0)

Третья игра зала: шахта квадратами, ломать пальцем, продавать добычу, брать
ранги A–Z. Правила — `src/lib/prison.ts` (чистые функции, тест темпа
`prison.test.ts`), текстуры — `lib/prison-art.ts`, крошка — `lib/prison-fx.ts`,
страница — `pages/PrisonPage.tsx`.

- **Каторга — главная игра, автоматы — её часть, а не наоборот.** Владелец,
  24.09.2026: «теперь наоборот, автоматы привязаны к игре». Решения
  принимаются от игры: что ей нужно, а не что выдержит ставка в автоматах.
  Масштаб чисел ниже остаётся как есть, но довод «так нужно автоматам»
  больше не решающий.
- **Новое не привязывать к Кольскому краю и к самому владельцу.** Он
  спросил прямо: «при чём тут я и Кольский?» То, что уже есть (сейды,
  Куйва, питомцы-фауна), остаётся; новые звери, события и промыслы —
  без местной привязки (летучая мышь, сорока, а не лемминг и песец).
- **Прежде чем добавлять — подумать, как вписывается.** Владелец: «не хочу
  недоработанных или бесполезных фич». Фича, которая повторяет уже
  существующую (ещё одна кнопка «снести кучу блоков» при девяти таких же),
  не делается, даже если она была в плане.
- **Деньги ОБЩИЕ с автоматами — это и есть смысл игры, а не допущение.**
  Продажа кладёт в `slotsBalance`, ранги и кузница списывают оттуда же.
  Владелец сказал прямо: «хочу чтобы деньги везде были общие, в этом
  прикол». Не заводите шахте свою валюту. Опыт за ранг и престиж тоже идёт
  в общий уровень — но с v2.66 уровень ничего не платит (см. «Экономика
  v2.66»).
- ~~Масштаб чисел — под автоматы~~ — **отменено в v2.66**: цены теперь
  постоянные таблицы `lib/economy.ts`, без миллионов и без стартовой тысячи.
  Раздел «Экономика v2.66» ниже главнее всего, что здесь написано о ценах.
- **Темп подобран симуляцией, не на глаз** (цифры ниже — история; нынешние —
  в «Экономике v2.66»): игрок держит палец, покупает
  кирку и заточку разумно, а токены тратит на зачарование с лучшей отдачей
  за токен — первый ранг за минуту, A→Z ≈ 2,3 часа у такого идеального
  игрока (живой — около трёх), ни один ранг не дольше получаса. Меняете
  `RANK_*`, `HP_*`, `VALUE_*`, цены кузницы или чар — тест темпа скажет, что
  уехало. Когда появились чары, круг схлопнулся до 1,7 часа: чары — главная
  кривая силы присона. Лечилось ценами чар (×1,6) и шагом ранга (1,33 → 1,36),
  а не ослаблением самих чар — они обязаны ощущаться. В v2.48 запал и
  уровень кирки снова ускорили круг — шаг ранга стал 1,37, сноровка кирки
  всего 0,5% за уровень; с нормой A→Z ≈ 2 часа у идеального игрока.
- **Шахта — яма, а не плоскость**: 7×9 клеток × 5 ярусов, глубже — богаче
  (с v2.66 — доля своей руды 50% сверху → 85% на дне, `OWN_SHARE`), на дне
  изредка порода следующей шахты. Поле собирается из
  зерна (`buildMine(id, seed)`), в сохранении только зерно и глубина раскопа
  по клеткам. Выработка 85% — шахта обновляется сама: последние блоки не
  ищут.
- **Поле шахты — `components/MineField.tsx` (с v2.57.1), а не страница.**
  Сетка с тенями стенок, пальцы (тап, удержание, ведение), кирка, крошка и
  всплывающие надписи — компонент `MineField`; урон, трещины, крит, слом и
  чары поля (жила, взрыв, отбойник, луч, трещина, камнепад) — хук
  `useMineDig`. Странице остаются только ПРАВИЛА (`DigRules`: чья порода,
  что закрыто, что забирает удар себе, куда идёт добыча через `onBreak`).
  Вынесено ради шахт подземелья: они обязаны копаться точь-в-точь как
  каторга, но складывать в сидор, а не в рюкзак. Если правите удар —
  правьте хук, иначе шахты разъедутся. Отложенные действия по полю
  (фитиль бомбы, волны) — через `dig.later`: сменилась шахта — не сработают.
  Loot flight (`fly`) lives in `.ploot-layer` on `<body>` (last in paint order), and the rows
  under the field (`.pmx-items/-foot/-dock/-quest`) keep `will-change: transform`: otherwise every
  block made Chrome promote and drop layers for them (5 s of digging — 300 layer-tree changes, the
  dock and bag re-layered 5–7 times) and on the owner's phone the whole bottom zone flickered.
  Check: `scratchpad/flick/layers.mjs` (0 new layers for those rows). Bag feedback pops the
  backpack icon only, never the full-width panel.
- **Урон по недобитому блоку живёт в странице, а не в сторе.** Удар — это
  5–10 событий в секунду; в стор уходит только сломанный блок
  (`prisonBreak`), и пишется шахта с задержкой 2 с (`makePersister(key,
2000)`), при сворачивании — сразу, как всё остальное.
- **Удержание бьёт через `hitRef`, а не через `hit` из замыкания.** Таймер
  заводится при касании; после обновления шахты под пальцем старое
  замыкание ломало бы породу прошлого поля.
- **Тапать можно быстрее удержания, но не бесконечно** (`tapGapMs` —
  1,8 скорости кирки). Ведение пальцем бьёт при входе в новую клетку под
  тем же ограничением, иначе провёл по ряду — снёс ряд.
- **Текстуры рисует код**, 16×16 без сглаживания, по 4 рисунка на породу:
  одна картинка во всех клетках складывается в кафель. Трещина — одна и та
  же ломаная, растущая по стадиям, а не три разные картинки. Три красные
  породы рядом (гранат, эвдиалит, рубин) сливались — гранат теперь
  оранжевый, эвдиалит малиновый. Новую породу проверяйте на поле её шахты,
  а не отдельной иконкой.
- **Глубину делают статичные вещи**: торец меньше (`scale`, не transform —
  трансформ занят ударом), темнее, и тень от стенок соседей (`--wt/--wl`)
  — `box-shadow`, который меняется только при сломе блока.
- **Крошка — с высотой**: у частицы есть z, она подлетает, падает и
  отскакивает; на экране y − z. Одна канва, цикл кадров живёт, пока есть
  частицы.
- **Токены и восемь чар (v2.47.0)** — как в X-Prison: токены падают с 5%
  блоков по 1–3, цена уровня — база плюс шаг, сброс возвращает половину.
  Всё, что меняют чары, престиж, перки и коллекция, считает ОДНА функция
  `modsOf()` — страница, стор и тест темпа берут множители только из неё.
- **На ударе срабатывает одно старшее зачарование** — отбойник, иначе взрыв,
  иначе жила. Три сразу превращают поле в кашу, где не видно ни одного.
  Кураж бросается отдельно.
- **Пачка блоков идёт одним вызовом стора** (`prisonBreak(list)`), но волна
  на экране — кольцами (`wave`), каждое своим тактом. Порода кольца берётся
  с поля в миг его слома: к третьему кольцу первое уже на ярус глубже. Волна
  помнит ключ шахты и не доламывает новое поле, если шахта обновилась.
- **Сундук открывается в обработчике нажатия, не в эффекте.** В разработке
  StrictMode гоняет эффекты дважды, и один тап открывал на стенде два
  сундука. Лента только доезжает до уже начисленной награды.
- **Лента сундука — через портал.** У листа `backdrop-filter`, а он делает
  лист рамкой даже для `position: fixed`: лента жила бы внутри листа.
- **Удержание — не `setInterval`, а таймер, который заводит себя сам** с
  шагом по текущей скорости: энергетик или кураж, начавшиеся под пальцем,
  ускоряют кирку сразу.
- **Бригада работает всегда**, не только офлайн: копит с `crewFrom` до
  потолка смены (8 ч, перк до 12). Подъём уровня сперва отдаёт накопленное
  по старой ставке. Доля бригады — 60%.
- **Находки открываются по шахтам** (`from`): в A не найти лампу забойщика.
  Каждая новая — +1% к продаже, вся коллекция — ещё +10%; дубликат — 40
  токенов; сундук кладёт только недостающую.
- **Перки — два очка за престиж, сброс бесплатный.** «Блат» после престижа
  ставит на ранг выше A.
- Всё, кроме шахты, живёт в одном листе «Лагерь» (`components/PrisonCamp`)
  с вкладками: кузница, чары, лавка, сундуки, бригада, коллекция, перки.

### Смена (v2.48.0) — норма, запал, уровень кирки, проводник

Этап А «Обдейта 2». Владелец, прочитав план: «Ру сегмент мне очень
нравится. Особенно чтобы прокачать лвл надо ломать определённые блоки».
Всё правило — в `lib/prison.ts`, тесты — `prison.test.ts`.

- **⚠️ Норма по породам и её откуп заменены в v2.66** выработкой (блоки
  любых шахт, не докупается) и блоками этажа (докупаются) — см. «Экономика
  v2.66». Пункты ниже про `rankQuota`/`quotaBuyout` — история.
- **Норма выработки — главная механика рангов, как на VimeWorld и
  Mineland.** Для ранга мало денег: нужно сдать самую новую породу шахты
  и ту, что перед ней (`rankQuota`). Считаются БЛОКИ, сломанные своими
  руками в любой шахте (`prison.norm`, сбрасывается на ранге и престиже),
  а не добыча: Удача и запал множат деньги, но руду за тебя не выкопают.
  Бригада в норму не идёт — иначе норму закрывал бы оффлайн.
- **Норму можно откупить — потому что деньги общие.** Цена откупа
  пропорциональна недобору (`quotaBuyout`, 60% цены ранга за всю норму):
  почти сданная стоит копейки. Занос в автомате вправе закрыть недобор,
  но ровно на ту долю, что не выкопана. Не делайте откуп бесплатным и не
  убирайте его: первое убивает норму, второе — смысл общего кошелька.
- **Размер нормы вычислен тестом, а не назначен.** Слепой копатель (бьёт
  что попало) к моменту, когда накопил на ранг, добрал норму примерно
  наполовину–полностью: «норма ощутима, но не стена» проверяет, что она
  держит его хотя бы в трети рангов, но не больше чем вдвое дольше денег.
  Норма «стареет» на 2,1% за ранг (`QUOTA_FADE`) — чары множат добычу с
  блока, и без этого поздние ранги превращались в стену. Меняете цены,
  ценность пород или чары — тест скажет, что норма уехала.
- **Точка в углу клетки — только на РЕДКОЙ породе нормы.** Ходовая лежит
  на каждом шагу: точки на половине поля ничего не подсказывают (так было в
  первой сборке). На ранге A нормы по редкой породе нет — точек нет.
- **Запал — серия копания, как Momentum на присонах.** Каждый сломанный
  блок подбрасывает счётчик; ступени Разогрев → Раж → В ударе →
  Стахановец → Легенда забоя дают +4…40% добычи. Четыре секунды простоя
  прощаются (продать рюкзак — не повод гасить), дальше каждые 2,5 с минус
  ступень, а с 1,5 с полоса мигает. **Живёт в странице, а не в сторе** —
  это награда за «сейчас», её не накопить впрок; в стор уходят только
  рекорд (`bestStreak`) и миссия дня. Вторая ступень была «Запал» —
  переименована в «Раж», иначе выходило «Разжечь запал до «Запал»».
- **Полоса запала сидит на верхней кромке рамы**, а не отдельной строкой:
  строка отнимала у поля 36 px. Баффы из-за этого переехали на нижнюю
  кромку.
- **Уровень кирки — от каждого сломанного блока** (`pickXp`), до 50-го.
  Даёт 0,5% урона за уровень, токены за каждый и ключ за каждый пятый,
  а главное — открывает чары по веткам (`ENCHANT_UNLOCK`: жила с 3-го,
  отбойник с 18-го) и поднимает их потолок (`enchantCap`, весь — к 40-му).
  Старое сохранение получает опыт = всё, что уже сломано, и уровни чар,
  купленные раньше, не срезаются — потолок ограничивает только покупку.
- **Чары покупаются пачкой** (+1/+5/+25/Макс — сколько хватит токенов и
  потолка), а жилу, взрыв, отбойник и кураж можно выключить, не теряя
  уровней (`off`, `ENCHANT_TOGGLE`): иногда нужен точный удар — добрать
  норму в одном месте, не сметя всё вокруг. Выключенная чара читается в
  `modsOf()` как нулевая — больше её нигде проверять не нужно.
- **Проводник** (`GUIDE`, 12 шагов) — квесты проводника VimeWorld: каждый
  шаг учит одной механике и платит за неё. Условия читаются из состояния,
  поэтому игрок из прошлых версий просто забирает сделанное. Пока проводник
  идёт, он стоит на месте строки с ценами пород, и полю оставлено на 30 px
  меньше высоты (`.prison.has-guide`); после — поле возвращается.
- **Миссии дня удалены в v2.66** (деньги из ничего). Ниже — как было.
- **Миссии дня общие с автоматами: две в автоматах, третья — в шахте**
  (`PRISON_POOL`: блоки, запал, продажа). Шахта трогает счётчики на каждом
  блоке, поэтому слоты оттуда пишутся ЛЕНИВО (`persistSlotsLazy`, 2 с,
  снимок берётся в момент записи): обычная запись с задержкой 300 мс
  превращалась в запрос на каждый удар — это тот самый кликер, который
  долбит сервер.
- Подарка «Награды» в шапке шахты с v2.66 нет. Темп (блоки и монеты в минуту) — на полосе запала,
  только пока копаешь. Сводки «Смена · 5 минут» нет с v2.159: владелец спросил «какие смены? мы
  же выключили их» — карточку читали как смены, которых в игре нет. Не возвращать.

### Добыча (v2.49.0) — передачки, руны, питомцы, пять чар, вехи

Этап B «Обдейта 2»: погоня за лутом. Правила в `lib/prison.ts`, тесты —
`prison.test.ts` (блок «добыча»), картинки — `lib/prison-art.ts`.

- **Передачка — Lucky Block присон-серверов.** Падает с блока
  (`PARCEL_CHANCE`, ~1 на 800 блоков), ложится на одно из трёх мест на
  нижней кромке рамы и вскрывается, когда добудешь ещё 150/400/900/2000
  блоков (по редкости). Зреют все сразу. Мест нет — сдаётся за токены.
  Главный источник рун и питомцев; монеты и токены в ней — подкладка.
- **Одна функция на награды — `applyReward`.** Сундук, передачка, веха и
  проводник раздавали награды каждый сам; с рунами и питомцами это
  означало бы четыре места, где руна ложится мимо мешочка. Монеты функция
  возвращает отдельно: они идут в ОБЩИЙ кошелёк, а не в шахту.
- **Руны — настоящий старший футарк**, и смысл знака совпадает с
  действием: Феху — продажа, Уруз — урон, Райдо — скорость, Йера — добыча,
  Гебо — токены, Совило — шансы чар поля. Рисуются ЛИНИЯМИ в SVG
  (`RuneIcon`): символов U+16A0 нет в половине шрифтов телефонов.
  Сила выпадает внутри полосы ступени (`RUNE_BAND`), поэтому две руны одной
  ступени не равны. Сплав: любые три руны одной ступени → ступень выше, вид
  у выбранной, сила не ниже средней из трёх; уходят две самые слабые
  СВОБОДНЫЕ (не из гнезда). Гнёзда: 5/15/30 уровень кирки, четвёртое — веха
  «Престиж 10». Мешочек на 40, лишняя руна разбивается на токены сама.
- **Питомцы — кольская фауна**: лемминг (добыча), песец (продажа),
  росомаха (урон), ворон (токены), полярная сова (ключи, находки и
  передачки), оленёнок (скорость). Растут от блоков, пока с тобой (25 ур.),
  второй такой же — лакомство текущему. Сидит на кнопке «Лагерь», тап по
  нему открывает вкладку питомцев. Спрайты 12×12 без полей: с полями
  зверёк на кнопке был с ноготь, а тёмного лемминга спасает светлый ободок.
- **Потолок прибавок (`BONUS_CAP`)** — руны и питомец складываются по виду
  и упираются в потолок (+100% к продаже и т. п.). Это обещание из плана:
  без потолка к престижам шахта печатала бы миллионы, и ставка в автоматах
  перестала бы что-то значить.
- **Пять чар**: Трещина (удар по четырём соседям, с 6 ур.), Луч (весь ряд,
  с 10), Перековка (блок засчитывается породой выше — и в цене, и в НОРМЕ,
  с 14), Камнепад (четыре взрыва по полю, с 22), Эхо (множит шансы чар
  поля, но не Перековки, с 26). Старшинство на ударе: отбойник → камнепад →
  луч → взрыв → жила → трещина, срабатывает одно.
- **Вехи**: 1 тыс./10 тыс./100 тыс./1 млн блоков, первый Z, престижи 1/5/10/20,
  Легенда забоя, вся фауна, сто сундуков, сто передачек. Передачка из вехи
  вскрывается сразу — места под полем она не ждёт.
- **Тест темпа теперь гоняет и добычу**: симулированный игрок вскрывает
  передачки, сплавляет руны, носит лучшие и водит самого выгодного
  питомца (ГСЧ с зерном — темп не зависит от удачи прогона). Добыча
  ускорила круг примерно на 10%: без неё A→Z 2,14 ч, с ней ≈ 1,9 ч; по
  разным зёрнам 1,8–2,0. Руны пришлось ослабить на 20% от первой
  прикидки. `PACE=1 npx vitest run src/lib/prison.test.ts -t A→Z` печатает
  разбивку — начинайте балансировку с неё.
- Проводник вырос до 15 шагов: три новых учат передачке, руне и питомцу.
  Прошедшие первые двенадцать увидят его снова — ради них.

### Слеза гаста и сейд-камень (v2.50.0)

Две просьбы владельца сверх плана.

- **Ключ от сундука — слеза гаста**, как предмет в Майнкрафте
  (`tearTexture`, `KeyIcon` рисует её везде, где был ключ). Слово в
  интерфейсе осталось «ключ»: это его работа, а слеза — вид.
- **Выпал ключ с блока — сцена тотема бессмертия** (`totemKey` в
  странице): слеза вылетает в центр экрана, растёт и проворачивается по
  оси Y (перспектива на слое), вокруг брызжут зелёно-жёлтые квадратные
  искры, потом она улетает в кнопку «Лагерь», где копятся ключи. Слой на
  весь экран, но только transform и opacity, живёт две секунды. Второй
  ключ, пока играет первый, — просто надпись: две сцены подряд съедают
  друг друга. Ключи за ранг и уровень кирки сцены не играют — у них свои.
- **Сейд-камень — священный камень саамов**, самая редкая вещь в шахте.
  На поле 0 (70% шахт), 1 (25%) или 2 (5%) — владелец просил «очень
  редкий всегда». Лежит только в глубине (ярусы 2–5): сверху его не
  видно, находит лупа («↓N» в углу клетки) или случай. Места — из того же
  зерна, что и порода (`seidsOf`), в сохранении ничего нового, кроме
  счётчика.
- **Сейд бьётся УДАРАМИ, а не уроном**: четыре попадания при любой кирке,
  крит — за два. Площадные чары (взрыв, жила, отбойник, луч, трещина) его
  не берут: иначе редкость уходила бы сама, мимо рук. Счёт ударов живёт в
  том же `hp` страницы, что и урон породы.
- **Платит токенами** (30 + 6 × ранг) и 5% цены ранга монетами — «токены
  у нас сложно добиваются». Это удвоило приток токенов, и круг A→Z у
  идеального игрока стал ≈1,5 ч (было ≈1,9). Нижняя граница теста темпа
  опущена до 1,4 ч НАМЕРЕННО — см. комментарий в тесте. Не возвращайте
  темп ценами чар: владелец хотел, чтобы прокачка шла быстрее.
- Веха «Хранитель сейдов» — десять разбитых.

### Настройки каторги (v2.51.0): касса владельца и сброс

- ⚙ в шапке шахты открывает «Настройки». Там та же «Касса», что в
  автоматах (`components/CashDesk`), и в ней теперь ещё ряд токенов каторги
  (+1 тыс./+10 тыс./+100 тыс.). Видна ТОЛЬКО владельцу — по тому же флагу
  `owner` из `/api/backup/status`, что и выданные скины. Касса нарисована на
  переменных скина автоматов (`--neon`, `--btn-*`), которых на странице
  шахты нет, — обёртка `.pcash` задаёт их свои.
- Сброс — два варианта, оба в два касания (первое взводит и пишет, что
  пропадёт; взведённая кнопка гаснет сама через 5 с):
  `prisonReset` — только Каторга, кошелёк и уровень остаются (они общие);
  `gamesReset` — всё в зале игр: Каторга, кошелёк к нулю (v2.66),
  уровень, серия бонусов, цели дня, рекорды, прогресс скинов. Звук,
  вибрация, турбо и скин не трогаются — это настройки, а не результат.

### Срок (v2.55.0) — спецзона, престижные породы, звёзды кирки

- **Рангов по-прежнему 26, пород — 31.** `MINES` теперь число (26), а не
  `ROCKS.length`: пять престижных пород (родонит, ловчоррит — хибинский,
  чароит, демантоид, александрит) лежат ТОЛЬКО в спецзоне, их шахты рангом не
  открываются. Везде, где проверяется номер породы (рюкзак в сохранении),
  граница — `ROCKS.length`, где номер шахты/ранга — `MINES`/`LAST_RANK`.
- **Спецзона — после первого престижа**, ступени по престижу 1/3/6/10/15
  (`ZONE_TIERS`) добавляют сверху новую породу. Зона живёт в той же
  `p.mine`, что и обычная шахта (номер выше Z), поэтому вся страница шахты
  работает без изменений; куда вернуться — `zone.back`. Сохранение не
  срезает номер шахты, пока `zone.on`.
- **Зона платит ТОКЕНАМИ, а не монетами** (`zoneTokens`): добыча не идёт в
  рюкзак. Богатая порода за монеты обесценила бы всю лестницу рангов после
  престижа, а токенов не хватает всегда. Удача и запал множат и токены зоны
  — они считаются от `drops.units`.
- **Время идёт только за работой**: между ударами засчитывается не больше
  3 с (`ZONE_IDLE_MS`), простой бесплатен, закрыть приложение — не потерять
  минуты. 10 минут в день, каждые 400 блоков нормы — ещё 10, до получаса.
  Новый день обнуляет счёт, но из зоны не выкидывает. Кончилось время — стор
  сам возвращает в прошлую шахту на ближайшем ударе.
- Ранг, престиж или переход в другую шахту закрывают зону; выработка шахты
  зоны (85%) даёт новую шахту той же зоны (`prisonGoMine` с её номером).
- **Звёзды кирки (престиж кирки)**: на 50-м уровне кирку можно перековать —
  опыт в ноль, +1 звезда (до 5): потолок КАЖДОЙ чары +20% (`enchantMax`),
  урон +10%, 500×N токенов и 3 ключа. Купленные уровни чар не срезаются,
  сохранение пускает уровни выше обычного предела, если звёзды есть.
  Это настоящий размен: сноровка кирки (до +24,5% урона) уходит вместе с
  уровнем и возвращается по мере раскопки.
- Тесты — `zone.test.ts`.

### Руны, сундуки, верстак, бригада (v2.57.0)

Владелец: руны «нарисованы ужасно и непонятно, и куда они накладываются —
написано просто кирка»; «дай открыть все сундуки разом и суммируй»;
«верстак — что это, что с вещами потом, продаются? почему не видно?»;
«в бригаде тоже интерактивности и механики побольше».

- **Рунный камень — пиксели 40×40** (`runeTexture`): арка сланца, двойная
  фаска, пятна и лишайник на простых, знак ВЫСЕЧЕН жёлобом (тень на
  верхней-левой стенке, светлая кромка камня снизу-справа), со второй
  ступени жёлоб залит светящейся смальтой цвета ступени, с третьей — ореол,
  с четвёртой — металлическая оковка углов, у пятой — самоцвет и искры.
  Рисовать знак шрифтом нельзя (футарка нет в шрифтах телефонов). Проверено
  листом 6×5 крупно. Показывать на кратных 40 px, иначе пиксели неровные.
- **Руны ставятся в ОБЕРЕГ, а не в кирку** (`AmuletArt`): бронзовый диск на
  шнурке, четыре гнезда крестом, в центре скрещены кирка и топор. Руны
  работали и на топоре (через `bonusOf` в `forestMods`), а вкладка писала
  «Кирка» — отсюда путаница. Гнёзда открываются уровнем кирки ИЛИ топора
  (`socketsOpen(p, axeLevel)`), Совило множит и шансы чар топора.
- **«Открыть все» сундуки** (`prisonOpenCases`): по одному подряд в сторе —
  находка из прошлого сундука уже в коллекции и не повторится. Экран
  (`CasesSummary`): плитки открываются очередью, потом итог — монеты,
  токены, ключи, расходники и лакомства СЛОЖЕНЫ, руны, находки и питомцы —
  поштучно. Тап — сразу к итогу.
- **Верстак — своя вкладка** (`BenchTab`) и у каждой вещи написано, куда
  она уйдёт: крепь — в ряд расходников шахты, рукоять — на кирку и топор,
  заказ — заказчику за деньги. **Собирают молотком**: выбрал вещь — бьёшь
  по кнопке, гвоздь за гвоздём (4–8 ударов), вещь проявляется на столе.
- **Заказы** (`benchOrder`, три места): ящик для рыбзавода, табурет, лыжи,
  бочка под засол трески, оконная рама, сани оленеводу, карбас поморам (с
  пятого разряда). Порода — чаще своя делянка. Платят в 1,6 раза дороже
  продажи тех же досок плюс токены; сдал — новый заказчик через 10 минут.
  «Любые доски» не трогают запас на рукоять. Картинки вещей рисует
  `benchTexture` в цвет досок породы; контур у них СНАРУЖИ (`outlineOut`),
  иначе двухпиксельная ножка табурета уходила в чёрное.
- **Бригада — наряды** (`CREW_SHIFTS`): норма (8 ч, ×1), ударная (2 ч,
  ×2,5 — для тех, кто заходит часто), разведка (6 ч, ×0,5, но ключи и
  передачки). Перк «Длинная смена» удлиняет любой. Смена наряда сдаёт
  накопленное по старому. **Пайка** — +30% на всю смену, но только в
  первые 10 минут, иначе кормили бы перед самой сдачей. **Приём смены** —
  вагонетки: тап опрокидывает, доля денег падает в счётчик; в конце —
  находки разведки. Бригада нарисована рабочими у штольни (у каждого своя
  рубаха); кончилась смена — сидят и ждут.

## Mine screen UI v2 (wave 2 — M, 13.10.2026) — `PrisonPage.tsx`, `pages/mine.css`

The mine screen is on the pixel kit (`@/ui-px`); all its CSS is in `pages/mine.css` (`.mn-*`).
Field drawing, mining, timings, critters and their animations are untouched.

- **Root `.gx.px.mn`**, fixed to the viewport, the page never scrolls. `mn--tall` when w ≤ h,
  `mn--wide` otherwise (from `useFormFactor`, not media queries).
- **Field is the hero.** `useFieldCell` (bottom of `PrisonPage.tsx`) measures the frame chrome and
  the free slot and sets inline `--cell` (20…160 px); wide reserves 2 × (84 + 4) u for the side
  columns. Cell per format (was → now): 390×844 50 → 50, 844×390 32 + page scroll → 37, 820×1180
  60 → 67, 1180×820 52 → 81, 1440×900 60 → 90, 1920×1080 60 → 107, 360×740 → 40 (round 2:
  taller rank row and phone dock cost tp 72 → 67).
- **Tall order:** HUD (back · money · tokens → books · keys → chests · ⚙) → rank row (floor chip +
  rank bar) → quest (guide only) → field (streak strip on the top edge, buffs bottom-left, parcels
  bottom-right, pets bottom-centre) → items → backpack → dock 3 × 2.
- **Wide (critic round 2):** left column = HUD (back · floor · ⚙ / money / tokens + keys), rank
  (bar row + needs row), streak panel, quest, items («Расходники» heading; hidden on phone
  landscape while the quest shows). Tablet/desktop (`roomy`): the backpack joins the left
  column and the dock fills the right one — one button per row, rows `minmax(21u, 36u)`, icons
  24u (painted 12×12 at ×2), side text ×1.15 (`--px-fs*` re-derived from C's `:root` copies
  `--gx-fs*`), desktop items 28u slots (4 per row) unless the quest shows. Phone landscape:
  right column = backpack + dock 2 × 3. Columns: basis 132u, min 88u, gap 2u. Measured empty
  height per column ≤ 15 % (pl 11 %, tl 10 %, d1 15 %, d2 6 %).
- **Dock** — six iron buttons, icon + label: forge, books, chests, pets, inventory
  (`input.action.inventory`), camp (`mineHud.dock.camp`). Books / inventory / camp icons are
  painted kit pieces `m-dock-books|bag|camp` (`paint.ts`, `// wave 2 — M`, char maps). Labels
  never break mid-word. Phone tall (M3): the tile is a COLUMN (icon over label), 26u high,
  label fixed `--px-fs-sm` (17 px), `nowrap; hyphens: none` — no `--lw` size formula (it gave
  13.7–17 px per label). Elsewhere `DockLabel`'s `--lw` formula still sizes the side-column
  labels; tr labels keep soft hyphens.
- **Hotkeys** (`useHotkeys`, scope = dock): F B C P I M L, E sell, R rank, 1–6 items; pad VIEW /
  X / Y. `KeyHint` is hidden by CSS for `data-input` touch / mouse.
- **Nothing jumps:** fixed heights for stats, rank box, needs row, streak strip, backpack, dock;
  tabular numbers; buffs / parcels / pets / toasts are absolute over the frame edges. Checked
  with a rect diff over money 0 → 1e9, tokens, keys, bag empty/full, items 0/333, parcels,
  buffs, rank ready, no pets — 6 formats, nothing moved.
- **Pitfalls:** the kit focus ring (`.px-f::after`, inset −3u) made the side columns scroll by 1u
  and got clipped — `.mn-side` has padding 3u and margin −2u. Stand scripts must import the
  store by the exact module URL from `performance.getEntriesByType('resource')` (after HMR the
  app uses `?t=…`; a bare `/src/store.ts` is a second store) and raise the resource-timing
  buffer first. Old mine `.pmx-*` CSS (35 classes) was pruned from `game-ui.css`; shared `.pmx`
  / `.pstrip` / `.pmx .prison` stay for Forest and Fishing.
- **Background:** light sandstone (`.prison-scene.pxt-stone` + a cream veil): dark pixels
  (L < 0.02) 6.9–10.8 % of the screen (was 21–46 %). Owner rejected the dark palette.
- **HUD numbers (M3): one size per chip, compact notation instead of a smaller font.**
  `lenVar` is gone. `.mn-stat` keeps a reserved width `--res` (coins 8, others 6 chars) and
  `.mn-stat__n` = `max(16px, min(--fs-n, (100cqi − icon − 2u) / (--res · 0.55)))` → coins 26,
  tokens/tear 20 on phones for 0…1e10. Formatters in `PrisonPage.tsx`: `chipMoney` (full below
  1e5, then `shortCount`), `chipCount` (≤ 4 visible chars: 9 999 / 98,7к / 987к / 1,2м / 999м /
  1 млрд), `paceCount`; `mineHud.g` = billions in 7 languages («1 млрд», «1 Mrd.», «1 Mr»).
  Tall layouts show no keys chip (tear count is on the chests tile badge); wide keeps it.
  Coin = painted `m-coin` (12×12) /
  `m-coin-s` (8×8) via `.mn-coin`; token/tear 12u. Floor chip: ore 16u + letter as a kit
  `Badge`, tip = the floor's name. Rank cost uses `shortCount` (until Q's `fmtCompact`).
- **Press:** N2's `usePress()` (`.is-down` on pointerdown) on every non-kit pressable (stats,
  rank, quest, parcels, bag, raw `.px-btn`s); content moves 1u down, never a filter.
  **No `squashPop`** on kit panels: `hop(el)` moves only `[data-hop]` icons by −1/−2 art px in
  `steps` (160 ms), skipped on reduced motion.
- **Rank ready** = child `<i class="mn-rank__ready">` (select frame, blink 1 ↔ 0.45, steps(2)) —
  `::after` belongs to the focus ring.
- **Re-renders:** `Keep` (memo with a `deps` array of primitives) wraps HUD, items, bag and
  dock; handlers that read state go through `live.current`. Digging re-renders 23 components
  per commit instead of 83 (`{SCR}/fibers.mjs`). Window openers use `startTransition`.
- **Under a camp / forge / inventory window** the root gets `is-under`: CSS animations of the
  screen parts (pets, parcels, frame, rank blink) are paused — the window lives INSIDE `.mn`,
  so the pause is scoped to `.mn-field, .mn-hud, .mn-side, …`, not `.mn *`. Style + pre-paint
  under the pets camp at 4×: 78 → 4 ms per 4 s. Left under the camp: PrisonCamp/Nursery
  re-render once a second (≈ 170 ms React per 4 s at 4×) — not the mine's code.
- **Short phones (portrait, ≤ 760 px high):** stack gap 1u, dock row gap 1u, HUD 18u, backpack
  22u, item slots 22u → 360×740 cell 40 (39 without the HUD/bag/slot trims).
- Sheets (floors, rank, prestige, settings) are `GxModal` with kit rows (`.mn-sheet`, portal ⇒
  unscoped classes); the rank-up scene (`prank`) keeps its animations, the look is kit (wood
  frame, one-line ribbon = horizon name, 40u gold badge letter, icon row `[ore] K · [coin] 14 ·
  [block] 1 000` with the sentence as `aria-label`, key line, gold button).
- **Sheet content is a `.px` root** (`<div className="px mn-sheet …">` inside the body): C's
  chrome then treats it as kit content — no ×2 body zoom at scale ≥ 4 (icons sized in px from
  `shell.scale` doubled to 88 px over the text at 1920×1080) and the kit well; the div scrolls
  itself (the kit body is `overflow: hidden`). Kit content also gets C's 420u width — the mine
  sheets put it back to 200u (`.gx-win .gx-win__box:has(.gx-win__body > .mn-sheet)`).
- **Round 3 (M3, critic r2 fixes).**
  - Quest (`.mn-quest`, tall): FIXED 26u box above the field — hex 16u | title clamped to 2
    lines | end column `max-content` (one `RewardChip` + the count/«Забрать» stacked in one grid
    cell, the unused one `visibility: hidden`). The full sentence is `data-tip` + aria-label.
    Field rect and `--cell` are identical over guide 0…14, ready / not ready, ru/de/tr, 390×844 and
    360×740 (`{SCR}/ui4M/m3.mjs … quest` → `uniqueFrames 1`). Wide: auto height, 2 rows.
  - Pace (`.mn-strip__pace`): its own `max-content` column whose width is set by an invisible
    ghost copy of the LONGEST strings («999 бл», «99,9к/мин») in the same grid cell; the live
    text has `contain: inline-size`, so live numbers never widen it. «N подряд» is not in the
    ghost (de «99,9k am Stück» made the column huge) — it wraps inside the live box.
  - Streak strip on phones spans the screen (`--sw: max(100% − 20u, 100vw − 8u)`); the tier
    `+N%` sits right of the streak bar (`.mn-strip__barrow`), not after the name — «Легенда
    забоя» needs the width.
  - Rank: the floor-letter badge on the floor chip shows only when the floor ≠ the rank (or in
    the zone), neutral tone (slot frame), never red. Wide + ready: «Новый ранг — жми!» moves to
    the needs row (`.mn-rank__go`) — in the bar between the hexes it wrapped into 3 lines. The
    «blocks mined» chip uses the painted 10×10 `m-dock-work` pick (fits the 10u needs row); rank,
    prestige sheets and the shift card use `.mn-coin`, no vector `CoinIcon`.
  - Dock inventory icon = painted `m-dock-inv` (open crate + gem + potion + coin), not the
    backpack briefcase. Camp «!» opens the tab that holds it (`openCamp`: miles → perks → crew).
  - Windows: openers call `freeze()` (adds `is-under` synchronously) then `startTransition`.
    ForgeScreen / BooksTab / Inventory / PrisonCamp are static imports — there is no chunk to
    prefetch.
  - Hit areas ≥ 44: parcels `::before` inset −5u −4u (47×51), tokens chip `::before` −4u
    vertical only (R43), back/gear 45–47. Confetti on rank-up: 40 on phones, 80 elsewhere.
  - Desktop items: `.mn-items` is a size container, slots `min(28u, (100cqi − 8u) / 5)` → 5 per
    row (critic: 4 + 1 wrap).
  - **Stand pitfall:** a Vite started with `watch.ignored: ['**/.claude/**']` ignores EVERY file
    of a worktree under `.claude/worktrees/` — the page silently keeps old CSS/TSX. Ignore by a
    function relative to the root (`{SCR}/ui4M/vite.mjs`) and check the served file with curl.
- **Round 3′ (M3′, 19.10, verified with `{SCR}/ui5M/m3.mjs <fmts> quest,nums,dock,pace,hit,fit`).**
  Items 1–4 hold on p320 (320×568@2), pp, p430, 360×740 in ru/de/tr: quest `uniqueFrames 1`; pace
  inside its column, 8 px (4u) to the bar; one digit size per chip (coins 26 / p320 21.1, tokens
  20 / p320 17.2), ≥ 16 px; dock labels 17 px, one line. `fit` = no page scroll, no element out of
  the viewport, no clipped text Range (vertical tolerance 0.3 em — line-height 1 boxes are not
  clips; sprite strips `.pet`/`pxs__img` are false positives).
  - 320×568: the field was height-bound at the old min cell 20 and its frame overlapped the
    items row by 20 px. Now `useFieldCell` min 12; `max-height: 640px` → dock tiles 24u, quest
    24u. Cell p320 21 (16 with the quest). `max-width: 340px` → strip `--sw` 100vw − 2u, pick
    column 22u («⛏50»), gaps 3u + pace `margin-left: 1u` (4u to the bar), HUD 1.25fr : 1fr,
    rank `padding-inline: 2u` («1/5» touched the frame). Pitfall: these media blocks sit ABOVE
    the base rules — raise specificity (`.mn .mn-frame > .mn-strip`, `.mn-dock .mn-dock__btn`).
  - Slim frame (`7·cell < 124u`, not wide — p320, 360×740 with the quest): `.mn-field.is-slim`
    puts the parcels in a column right of the frame (the centred squad covered them; hit 34 → 47).
  - Phone landscape dock: the column tile (icon over a fixed 17-px label) applies to every phone
    (`html[data-ff^='phone'] .mn-dock__btn`), height 26u only on tall — tr «Demir-hane» wrapped
    at 15.1 px in the 123 × 72 tile.
  - Tablet/desktop strip panel: rows `'name name' 'pick bar' 'pace pace'` (`.mn-strip__streak`
    `display: contents`), pace row fixed `var(--px-fs-sm)` — tl de «Stollenlegende» (195 px) was
    clipped to 130. Tablet + quest: no «Расходники» heading, items one row (cqi slots) — the bag
    and «Продать» were 88 px below the tl column.
  - `chipCount` from 1e9: the shorter of «999м+» and `shortCount` (tr «1 Mr»); tokens `--res 6.5`.
  - Item 5 (probe `{SCR}/ui5M/i5.mjs`): floor letter only on another floor, `slot-r0` ink badge;
    wide floor chip 19u square; `m-dock-inv` ≠ bag; camp «!» opens miles/perks/crew; wide HUD
    focus order back → floor → ⚙ → tokens → keys = visual. Hit ≥ 44 everywhere (back/⚙ 45 on
    36-px HUDs via `::before` −4u vertical).
  - NOT met: windows at 4× (dev, `motion.mjs pp win`, THR=4): forge 298, books 294, chests 228,
    pets 312, inventory 263, camp 236, floors 182, rank 191, settings 177 ms (targets 250 / 100).
    Every opener re-renders the whole `PrisonPage` (sheet state lives there) — next step: a
    sheet host with its own state. Digging at 4× (`motion.mjs pp dig`): 55/296 = 19 % frames
    > 20 ms (r2 24 %), p95 67, 12 long tasks, worst 150; 1×: 6/415. HUD/strip rects unchanged
    while digging (pp, tl). The rest is the field engine (`MineField`/`useMineDig`).
- **Round 4 (M4, critic r3 findings 1, 2, 3, 5 + pl floor chip; scripts `{SCR}/ui6M/`).**
  - Item icon from the slot (R62): `.mn-item --ic = min(--ic-max, round(down, --slot − 4u, u))`,
    max 13u (16u on tablet/desktop wide); `ItemIcon` has no size prop. tl + quest 48 in a 39-px
    window → 33 (11u); tablet quest row is centred with cqi gaps. Check `items2.mjs` (icon ⊆
    `.px-slot__art`, width % u, every format × quest on/off).
  - Hint names (R64): `guideHint(id)` passes `{camp}` = `mineHud.dock.camp` and `{runes}` =
    `camp.tab.runes` into `guide.*.hint`; the parcel hint says «у поля» (they ripen beside the
    frame). `mineHud.dock.more` is gone. `f3check.mjs` compares every quoted name with the
    visible dock / tab labels in 7 languages.
  - 320-px cell (R63): `itemsCol` = phone, not wide, `shell.h ≤ 640` → the items leave the row
    and become a 21u column left of the frame inside `.mn-field.has-items` (field padding-inline
    23u; 6 items = two columns, 45u / 19u). Pets sit 13u lower so no sprite covers a bottom-row
    cell centre (`row9.mjs`). Quest at ≤ 340 px shows one reward. Cell p320 16 → 21 (quest),
    21 → 26 (none); pp 43/49, p430 52/56 unchanged.
  - Streak strip (finding 5): the strip frame is `frame-well` (2u painted, was `slot-r0` 4/3);
    streak rows 7u/7u grid, flame `m-flame7` (7×7 drawn in a 9×9 mask, `mask-size 9u`), name
    line-height 1. Ink test (`ink.mjs` + `inkdiff.py`: screenshot with/without content, every
    changed device pixel inside strip − painted frame) is 0 px outside on every format. A Range
    test can't pass: two text rows (Rubik 17 px content box 20.1 px each) never fit in 32 px.
  - Phone landscape: strip 27u (rows 14u / 8u) — the pace line hung 3 px below; quest items 22u
    (the 27u strip pushed them 1 px off-screen); floor chip hit 39 → 44×46 via `::before`
    extended to the right only (left would eat the back button).
  - Rank conditions (M4b): the one-line row «⛏12 · 4 299/4 300 · 9/10» needed 237–240 px (u 2)
    / ~320 (u 3) and was cut by `overflow: hidden` (p320 172, 375×600 219, pp 228) or spilled out
    of the tl column. The blocks chip is its own `RankBlocks` beside the coin bar; the pick chip
    lost its anvil (pink `#ffb4a0` on parchment, ~20–30 px). Tall (phone + tablet): two rows in
    the same 22u — bar + blocks / pick + work (p320 rank gap 2u: row 170 of 176). Wide: grid
    hex · bar · blocks · hex over pick + work (pl, desktop: height unchanged); a narrow frame
    (`.mn-rankwrap` = container `mnrank`, ≤ 299 px at u 3, ≤ 224 at u 2: tl, 667×375) uses three
    fixed rows — work / pick | blocks around the centre (tl rank 108 → 138 px). Check
    `{SCR}/ui6M/needs2.mjs <fmts> <langs>`: every chip Range ⊆ its row on all 25 ranks × worst /
    empty / done, bar label ⊆ bar, row positions constant.
  - Guide hints name labels, not places (M4b): `guideHint` also fills `{chests}` `{books}`
    (dock), `{sell}` (the bag button word, `mineHud.bag.sell` without the sum), `{streak}` (idle
    strip), `{bag}` (forge row, `forge.bag` without the number); the bomb hint is «Тапни по
    бомбе, потом по клетке поля». `{SCR}/ui6M/f3check2.mjs <langs> <fmt>`: rendered hints, no
    place word per language, every quoted name visible on screen.
  - Not fixed (outside M4): finding 4 (sheet host) is the lead's; 667×375 and 1280×720 /
    1366×768 with the quest overflow the left column (pre-existing, `{SCR}/ui6M/side.mjs`);
    keys chip at 99,9 млн overflows on tl/d1/pl tr (unrealistic count).
- **Round 5 (M5, critic r4 findings 1–3; scripts `{SCR}/ui7M/`: `deskfit.mjs`, `m3.mjs`,
  `row9b.mjs`, `needs2.mjs`, `sellfit.mjs`, `coins.mjs`, `f3shot.mjs`).**
  - Bag column (`useSideFit`, bottom of `PrisonPage.tsx`, every wide layout): the bag sits at the
    bottom of the left column while the column fits, else at the top of the right one over the
    dock. The hook sums the left column's children + the bag WHEREVER it stands (no flip-flop),
    ResizeObserver on both columns' children + MutationObserver for moves. A column that still
    overflows gets `data-more` → a 2u stepped shade at its bottom edge (sticky `::after`); none of
    the measured windows shows it. Right dock `min-height: 0` (the flex item's auto minimum kept
    the rows at 36u: 1366×657 right column overflowed 60 px).
  - Wide quest = one height on every step: title row 2.2 × `--px-fs-sm` (always two lines), end
    row 15u, padding 2u, no progress bar (the «N/M» count is in the card). It changed 96 → 135 px
    between steps (1280×720 de) and would move the bag on some steps only. No «Расходники»
    heading on any wide layout while the quest shows.
  - Phone landscape ≤ 400 px high (`mn--short`: 667×375, 844×390): `itemsCol` → the items are a
    21u column at the frame's LEFT edge (field `padding-left` 23u only; `useFieldCell` subtracts
    the slot padding on wide too), six items one column; dock one column of 6 rows (icon left,
    17-px label, rows ≥ 21u, `::before` ±1 px → hit 44); side gaps 1u, HUD row gap 1u, bag
    padding 3u/2u, sell padding 2u; quest end row spans the card under the hex (ready «Забрать»
    was 18 px out of the 177-px column); squad `bottom: cell/2 − 18u` (3 pets covered 5 / 3
    bottom-row centres). Cell 667×375 35 → 32, 844×390 37 → 37. Without the quest the bag fits
    the left column there too (dock rows 58 / 61 px), with it the bag is on the right (43 / 46).
  - Sell sum = `chipCount` (≤ 5 chars, «244к», «10,5м»), not `fmtShort` («244,1 тыс.» was 31 px
    out of the tl button, de «Verkaufen 244.091» out on every phone).
  - Rank pick chip = `PickIcon pick={needPick}` 8u + the power (tip / aria `mineHud.norm.pick`);
    floors sheet and the «too hard» pop-up use the painted 7×7 `m-hard` crystal (`paint.ts`
    `HARD_ART`, `.mn-pic--hard`, `.mn .pfloat--hard::before`; the pop-up text is just the
    number). `.mn-rank` has no «⛏»; `mineHud.norm.pick` is «Кирка: сила {power} · {name}» in 7
    languages (glossary «Сила»; the rank sheet row wraps to 2 lines at 320 ru/de like its
    neighbours). Still «⛏»: `MineField`'s `pcell__hard`, toasts `mineHud.*.hardHave/Need/None`.
  - Rank box on `mn--short`: padding and column gap 2u (de/tr «1.100 ●» bar label was 1.4 px out
    in the 165-px column, `needs2`).
  - HUD chips hold 0…999 999 999 (`coins.mjs`, ru/de/tr): money `chipMoney` fits everywhere
    (p320 19.7 px, phones 26, pl 28, tl/d1 36); tokens `--res` 6.5 → 7 (tr «99,9Mn» was 2.7 px out
    at 320 → 16 px). Left column narrower than 42u + 5.75 × 16 px (667×375) → `useSideFit` sets
    `data-tight`, the keys chip hides (tokens + keys «999» did not fit one row even at 16 px) —
    keys stay as the gold badge on «Сундуки». The critic's «1 instead of 1,2м» was the old
    `.pmx-chip--coins` HUD (build 78071db); the v2 `.mn-stat--coins` shows «1,2м». Still open:
    the wide keys chip holds ~3–4 chars (tl «9.999» 2.8 px out, tr «99,9Mn» 8–13 px out).
  - «Продать N ●» label inside its button (`sellfit.mjs`): tall ≤ 380 px the bag grid is
    14u | 1fr | 2fr with gap 2u (p320 de «Verkaufen 9.665» 161 px in a 133-px button pushed the
    coin off screen → button 172); tablet landscape sell label `--px-fs-sm` (tl de 245 px in 223
    → 213).
  - Dig layers (lead's defe0ee for the old `.pmx-*` HUD, redone for v2): `.mn-items, .mn-dock,
    .mn-bag, .mn-quest, .mn-strip` `will-change: transform`; `.mn-hud, .mn-rankrow, .mn-rank`
    `isolation: isolate` (their z 1–3 — rank bar label, floor badge, focus rings — painted after
    the field's animations and were re-layered on every hit); bag icon z 4 (above its bar and the
    bag's ring). `{SCR}/ui7M/layers-mn.mjs` (copy of `flick/layers.mjs`, `BASE=…5566`): 5 s of
    digging at pp/pl/p320/tl — 0 new layers outside the field (was dock badge 6, bag bar 6,
    streak strip 6, rank label 8, a 388×582 squash layer). Cost: at 320 a HUD chip's ring loses
    16–74 px of its bottom edge under the rank box (`ringcmp.mjs` + `ringdiff.py`).
  - Dock at 844×390 (critic17 measured the old HUD, 51a9c8e): dock 8–382 / 97–382 with the
    quest, «Лагерь» hit inside, column 386/386, page 0 (`dockvis.mjs`).
