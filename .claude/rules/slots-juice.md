---
paths:
  - "src/pages/{SlotsPage,ScatterPage,GamesPage}.tsx"
  - "src/lib/{rollup,juice,reel-motion,orb-merge,orb-rarity,scatter,slots,slots-meta,use-exit,confetti,coins}.ts"
  - "src/components/{MoneyCounter,slot-art}.tsx"
  - "src/pages/{casino-ui.tsx,casino.css}"
  - "src/components/{SessionCard,SkinSheet,CashDesk}.tsx"
  - "public/slots/**"
---

<!-- Перенесено из CLAUDE.md дословно (v2.87): грузится, только когда
     открыт файл из `paths`. Тема: Автоматы: сочность, редкость сфер, подсчёт денег, барабаны, слияние сфер. -->

## «Сочность» и редкость в играх — как это устроено

Правила игр не менялись; менялось только то, сколько игра о них рассказывает.

- **Сфера — это СОДЕРЖИМОЕ клетки, наравне с символом и скаттером.**
  `ScatterCell` — это `SlotSymbolId | 'scatter' | \`orb:${number}\``, и
  клетка-сфера рождается там же, где все остальные: в `cell()` движка, когда
  собирается поле. Отдельного списка сфер нет нигде — `gridOrbs(grid)` просто
  читает поле. Сфера едет в ленте барабана (`fillerCell`), встаёт в клетку,
  съезжает вниз при каскаде и блокирует восьмёрки, потому что она и есть
  клетка. **Никаких «свойств» поверх клетки, никакого слоя, никакой подгонки
  координат.** Две прошлые попытки сделали ровно это — сначала отдельный
  абсолютно позиционированный слой, потом поле `orb` в `BoardCell` с
  досыпкой `spawnOrbs` поверх готового поля, — и обе владелец опознал как
  наклейку, трижды повторив просьбу. Признак, что кто-то снова сворачивает
  туда: появляется место, где сфера возникает ПОСЛЕ того, как поле собрано.
- **Своей анимации появления у сферы нет и быть не должно.** Она приходит
  `tumble-fall`, как любая клетка. Клетки поля пересоздаются на каждом такте
  каскада, поэтому разовая анимация появления переигрывалась бы по два раза
  за звено; а главное — ни один символ так не приходит, и собственное
  «всплытие» тут же выдаёт в сфере чужеродный предмет. Приход отмечают звук
  и вибрация (`playOrbs`): они такту перерисовки не подчиняются.
- **Сферы копятся не потому, что их берегут, а потому что убирать их
  нечем.** Они не выигрывают → не попадают в `dead` → остаются в колонке.
  Вся «накопительная» механика — это следствие правил поля, а не отдельный
  код.
- **У `.sboard__col` намеренно НЕТ `overflow: hidden`.** Клипает само поле.
  Верните клипание колонке — и самоцвет при сборе обрежется на её границе,
  когда полетит к счётчику в центре; ровно из-за этого он когда-то и жил
  отдельным слоем.
- **Клетка под сферой в восьмёрку не идёт** — в этом размен: сфера платит,
  но загромождает поле и укорачивает цепочку. Именно поэтому таблица выплат
  может быть выше, чем была бы без этого. Проверяется тестом «закрытая сферой
  клетка не попадает ни в один выигрыш».
- **Сферы срабатывают ОДИН раз, в конце**, умножая весь выигрыш
  последовательности; складываются, а не перемножаются. Падают всегда — и на
  спине, который не сыграл. Раньше они умножали каждое звено отдельно и
  выбрасывались без выигрыша: сферу можно было не увидеть за сотню спинов.
- **`ORB_CHANCE` — шанс отдельной КЛЕТКИ, и отдача почти линейна по нему**
  (≈3 процентных пункта на каждую тысячную). 0,019 даёт ~92% на 300 тысячах
  сессий, сферу примерно в половине вращений, цветную — каждое двенадцатое.
  Меняете — перемеряйте; на глаз тут промахнуться легко, я промахивался.
- **Редкость сфер — в `src/lib/orb-rarity.ts`.** Лестница не придумана, а
  вычитана из таблицы весов `ORB_TABLE` (`lib/scatter.ts`): 66 / 22 / 9 / 2,2 /
  0,6 / 0,2 %. Шансы НЕ менялись — они и так были такими, просто ×2 и ×500
  рисовались одинаковым золотым шариком. `orb-rarity.test.ts` сверяет
  заявленные проценты с настоящими весами, поэтому правка номиналов уронит
  тест, а не пользователя. Верхняя ступень называется «Реликвия» —
  существительное среди прилагательных, оно нарочно ломает грамматику
  лестницы («у меня правила другие»).
- **Бонус должен быть виден делающим работу, а не посчитанным.** Выплата
  идёт в два такта: сначала база, потом сферы слетаются в счётчик, сумма
  тикает вверх и ударом припечатывается — и число растёт на глазах. Пока
  выплата приходила одним готовым числом, множитель существовал только
  внутри выражения. Если трогаете эту часть, держите правило: **строка «что
  сыграло» и счётчик обязаны показывать одну и ту же стадию арифметики**,
  иначе множитель выглядит ни на что не влияющим.

### Подсчёт денег — `src/lib/rollup.ts`

Самая важная сцена спина и та, которую проще всего испортить. Три правила,
и все три нарушались одновременно, пока счёт шёл через `AnimatedNumber`:

- **Длительность ПРОПОРЦИОНАЛЬНА выигрышу и не назначается руками.** Она
  складывается из того, сколько ступеней выигрыш пробил: мелочь считается
  полсекунды, максимум — пятнадцать. Фиксированная длительность (было 400 мс
  в табло, 700 в результате, 1400 в тотеме) — это ровно то, из-за чего
  ×500 проскакивал за то же время, что и ×2, и владелец написал «упала
  сфера 500х… но на деле так быстро всё посчиталось, в общем нет изюминки».
- **Счёт ПРОБИВАЕТ пороги, а не доезжает до итога.** На каждой ступени
  (`WIN_TIERS`) он замирает, звучит удар, меняется титул — и идёт дальше.
  Смотрят именно на «не остановился»; пауза здесь не задержка, а вопрос.
  Со ступени «КРУПНЫЙ ВЫИГРЫШ» сцену забирает тотем, и счёт продолжается
  в нём — **он не начинается заново**, это тот же ход на крупном плане.
- **Темп РОВНЫЙ.** `easeOutCubic` (как было) разгоняется и тормозит к концу:
  старшие разряды пролетают, последние копейки ползут. Механический ролл-ап
  не ускоряется — он идёт как счётчик на бензоколонке.

Ещё из важного:

- **Сочность счёта даёт ТЕМП, а не форма цифр.** Я потратил заход на
  механический одометр — колесо с цифрами 0…9 на каждый разряд — и владелец
  забраковал его одним словом: «цифры такие себе». Он прав, и причины две.
  При непрерывном ходе колеса на экране постоянно висит ПОЛОВИНКА цифры: на
  62 пикселях это механика, на восемнадцати — рваный текст. И каждому колесу
  нужен свой `overflow: hidden`, а он обрезает свечение — вокруг каждой
  цифры вырастает своя светящаяся прямоугольная коробка, и число
  рассыпается на плитки. **Не возвращайте колёса.** Цифрам достаточно быть
  крупными, целыми и читаемыми на любом кадре (`components/MoneyCounter`).
- **Счётчик обновляется через ref, а не через состояние.** Счёт идёт каждый
  кадр; гнать его через `setState` — значит перерисовывать полстраницы
  шестьдесят раз в секунду. `runRollup` пишет прямо в `textContent`.
- **Множитель — ЖЕТОН, а не надпись.** У `.stamp` своя оправа: тёмная плита
  в золотой рамке, подпись «выплата» и число под ней, а поле под жетоном
  гаснет (`.sboard__veil`). Светлая цифра поверх светлых символов не
  читалась вовсе — самый важный момент спина проходил мимо глаза. Градиент
  ступени живёт на `.stamp__n`, а не на самом жетоне: `background-clip: text`
  на жетоне съел бы оправу.
- **Удар множителя обязан сыпать монеты.** Раньше в этот кадр менялось
  только число, и «начислилось» было не видно. Количество монет — по
  сложившемуся номиналу: ×3 это горсть, ×200 — ливень.
- **Баланс крутится в один ход с выигрышем.** Деньги прибывают на глазах,
  а не начисляются задним числом.
- **Счёт обязан быть пропускаемым.** Тап по автомату или по тотему
  досчитывает мгновенно. Без этого крупный выигрыш становится наказанием
  ожиданием — особенно в автоспине и бонусе.
- **Редкая сфера (beats ≥ 2) получает сольный выход** перед сбором: поле
  гаснет, камень выходит крупно и назван по имени. Ступени ниже выходят
  молча — выход, который случается каждый второй спин, это уже не выход.
- Счёт **один на обе игры** нарочно. Если считать по-разному, одна из игр
  ощущается дешевле другой.
- **`src/lib/juice.ts` — приёмы, а не библиотека.** Стоп-кадр (пауза читается
  как удар, её длина — как сила), кадр-вспышка (прячет склейку: всё, что
  меняется во время вспышки, читается как ею вызванное), тряска по Айзерло
  (копится «травма», смещение ∝ её КВАДРАТУ, гладкий шум вместо
  `Math.random` — случайное число на кадр выглядит как сломанный телевизор).
  Трясётся корпус автомата, а не страница: внутри Telegram дёрганье всего
  экрана читается как баг вебвью.
- **Падение клетки: НИКАКОГО перелёта.** `tumble-fall` (обе игры) долго ехал
  на пружине `cubic-bezier(.34,1.34,.5,1)`. Пружина выносит клетку примерно
  на 3,7% ПУТИ ниже её гнезда и возвращает обратно: на падении в пять рядов
  это тринадцать пикселей — символ заезжает в чужую клетку и отскакивает.
  Владелец описал это дословно: «некоторые символы прыгают и возвращаются на
  место». Все четыре контрольные точки кривой обязаны лежать в [0,1] — тогда
  перелёт невозможен в принципе, а не «почти незаметен». Пружина хороша для
  жетона и титула (они одни в кадре), но не для тридцати клеток сразу.
- **Падение — свободное: время ∝ КОРНЮ из высоты, разгон квадратичный.**
  `--fk = √(dy / рядов)` считает страница, длительность `--dur · --fk`,
  кривая `cubic-bezier(.11,0,.5,0)` — это ровно y = t². Так под одной
  гравитацией падает всё, и отсюда главное: клетки одной колонки, сорвавшись
  разом, держат дистанцию, пока нижняя не сядет. Две прошлые формулы этого
  не давали: сначала все летели ровно `--dur` (ближняя ползла, дальняя
  телепортировалась), потом линейно `0.55 + 0.09·dy` с кривой ease-in-out —
  клетка парковалась, как лифт, а в середине падения верхняя налезала на
  нижнюю на треть клетки. Самое длинное падение (все ряды) длится ровно
  `--dur`: иначе клетка не успеет сесть до следующего звена.
- **Приземление — сплющиванием от дна, а не отскоком** (`tumble-land`, второй
  анимацией на той же клетке, `transform-origin` у нижнего края). Клетка ни
  на пиксель не заходит к соседу снизу — правило «никакого перелёта» цело, —
  а вес у удара появился. Сила ∝ `--fk`: с одного ряда еле видно.
- **Поле пересобирается ОДИН раз за спин, а не на каждом звене.** В `runStep`
  стоял `setBoard(gridToBoard(step.grid))` для каждого `i` — а на экране уже
  стоял результат прошлого схлопывания, и он в точности равен `step.grid`
  (движок берёт следующее поле из `step.next`). Лишняя пересборка меняла всем
  тридцати клеткам React-ключ, то есть уничтожала и создавала заново тридцать
  span'ов с картинками ровно в тот кадр, когда начинают играть рамки
  выигрыша. Признак, что кто-то вернул это обратно: `gridToBoard` вызывается
  без проверки `i === 0`.
- **Под `filter` нельзя анимировать НИЧЕГО.** Правило «не анимируем `blur()`»
  знали все, а это — его обратная сторона, и на ней я обжёгся. `filter` на
  родителе (у нас `blur(1.4px)` на `.sboard__strip` во время вращения)
  заставляет браузер растеризовать ВЕСЬ его поддеревом в одну текстуру.
  Пока внутри неподвижно, текстура считается один раз за спин, а вращение
  идёт трансформом — композитор двигает готовый слой. Но одна бесконечная
  анимация внутри протухает текстуру каждый кадр: лента перерисовывается и
  переразмывается целиком. У сфер таких анимаций было две — `orb-throb` на
  каждом камне и `orb-ring` у эпической и выше, — и владелец описал это
  так: «когда барабан крутится и там есть сферы, всё прыгает, а когда сфер
  нет — крутится чётко». Гасим именно АНИМАЦИИ, а не эффекты: статичные
  `drop-shadow` и конический градиент попадают в ту единственную
  растеризацию и в движении не стоят ничего.
- **⚠️ НЕЗАКРЫТОЕ: та правка выкачена, но НЕ подтверждена.** Механизм выше
  верен сам по себе, а вот что чинит он именно этот симптом — не доказано.
  Замер на 24 спинах до и после: 14,79 → 14,25 длинных кадров (>32 мс) на
  спин, p95 34,8 → 33,4 мс. Это шум; упал только худший кадр (117 → 67 мс),
  а это одно наблюдение. Контрольной группы «без сфер» получить не удалось:
  в 48 замеренных спинах сфера в ленте была всегда (при `ORB_CHANCE` 0,019 и
  ленте на 114 клеток это ожидаемо — пустая лента примерно в одном спине из
  девяти). Попытка сделать контроль, выкинув клетки-сферы из DOM руками,
  была ошибкой: этими узлами владеет React, и следующий рендер ломается —
  прогон завис. **Стенд, скорее всего, просто слеп:** headless Chromium в
  контейнере рисует софтверно, и полтора десятка просевших кадров за спин
  могут быть его собственным потолком. Проверять надо на живом телефоне.
  Если симптом остался, следующий шаг радикальнее и требует решения
  владельца: **убрать `blur(1.4px)` с ленты во время вращения совсем** —
  именно `filter` превращает всю ленту в один тяжёлый слой, но размытие там
  стоит за ощущение скорости, и потерю надо оценивать глазами.
  С v2.44.0 размытие живёт только на ровном ходу (см. «Барабаны» ниже), то
  есть под `filter` лента проводит меньше половины вращения — у первой
  колонки «Каскада» 350 мс из 780 вместо всех 780. Подтверждения на
  телефоне по-прежнему нет.
- **Бюджет кадра.** Анимируем только `transform` и `opacity`. **Никогда не
  анимируем радиус `blur()` и параметры градиента** — это перерисовка всего
  кадра. Вращающийся `conic-gradient` рисуется один раз и крутится
  трансформом; это главная ошибка в этой категории на мобильных. Дорогие
  слои (орбита, лучи, радужный перелив) включены только у ступеней, которые
  встречаются меньше чем в 1% случаев.
- **Эскалация обязана быть неравномерной.** Редкое отличается от обычного не
  цветом, а числом тактов: лишняя пауза, отдельный звук, своя вибрация. Если
  показывать легендарную сферу тем же способом, что и обычную, она перестаёт
  быть легендарной. По той же причине лучи за тотемом крутятся только на
  мега-выигрыше.
- Всё перечисленное выключается под `prefers-reduced-motion`.

### Барабаны — `src/lib/reel-motion.ts`

Вращение обеих игр — один план на ленту, проигрываемый через
`Element.animate`. Замер на стенде показал, что было сломано, и все пункты
ниже — ответы на конкретные цифры, а не вкус:

- **Была одна кривая `(.18,.76,.24,1.06)` на всё вращение.** Она стартует
  вчетверо быстрее средней скорости и тормозит всё остальное время: первая
  колонка «Каскада» проходила 90% пути за 400 мс из 780 и дальше ползла,
  всё ещё размытая. Пик — 78 px за кадр, больше клетки: символы стробили.
- **Теперь пять фаз:** замах назад на 0,12 клетки → квадратичный разгон →
  РОВНЫЙ ход → торможение с проездом на 0,16 клетки → возврат в гнездо.
  Кривые подобраны по наклонам на концах, скорость на стыках непрерывна —
  это проверяет тест, а не глаз.
- **Скорость ровного хода ОДНА у всех барабанов обеих игр**: 0,024 клетки/мс
  (≈0,4 клетки за кадр — быстрее глаз теряет направление). Путь ленты
  считается ИЗ длительности. Раньше путь был общий, и поздний барабан просто
  ехал медленнее раннего — шесть колонок в середине спина стояли почти
  одинаково, и поочерёдной остановки не было видно.
- **Лента стартует с того, что на поле.** В «Каскаде» первые клетки ленты
  были случайными: в первый кадр каждого спина всё поле 6×5 подменялось.
  Страница держит `shownGrid` — что стоит на экране прямо сейчас (после
  каскада и после досыпки на место сфер тоже), — и с него строит ленту.
- **Голова и хвост ленты обязательны**: замах открывает клетку над окном,
  проезд — под ним. В «Каскаде» хвоста не было, и на отскоке снизу мигала
  пустая полоса.
- **Длинное вращение идёт по петле.** Предвкушение бонуса тянет колонку
  секунды по три; при одной скорости лента выросла бы до сотни клеток.
  Участок пролёта повторяет в конце своё начало, и лента на ровном ходу
  прыгает назад на длину петли — в окне в этот миг то же самое (кадры с
  одинаковым `offset`). Потолок — 48 клеток пролёта.
- **Размытие — только на скорости**, звук остановки — в момент, когда
  символы дошли до гнёзд (`impact`), а не после отскока.
- **Покой — инлайн-стилем, не заливкой анимации.** Законченная анимация с
  `fill: forwards` числится у элемента, и стоп-кадр (`hitStop`) перезапускал
  бы её: запуск законченной анимации перематывает её в начало, и поле
  закрутилось бы ещё раз. Сам `hitStop` теперь трогает только анимации
  в состоянии `running` — до этого он точно так же переигрывал упавшие
  клетки, жетон и титул на каждом ударе во время счёта.

### Слияние сфер пузырями — `src/lib/orb-merge.ts` (v2.45.0)

Запрос владельца: «если на поле больше одной сферы, пусть объединятся в
одну, анимация как мыльный пузырь, много вариантов, продумай турбо».

- **Только в такте сбора, правила не тронуты.** Сферы по-прежнему лежат
  клетками до конца цепочки и срабатывают один раз; слияние — это то, КАК
  они собираются в финале, когда сфер ≥ 2. Одна сфера улетает в жетон, как
  раньше. Слить сферы посреди каскада значило бы освободить клетки под
  восьмёрки — это уже другая отдача, а не анимация.
- **Двигаются сами клетки, а не наклейки.** План считает путь каждой
  клетки-сферы, страница проигрывает его `Element.animate` на самой клетке.
  Число на общем пузыре — это id клетки (`orb:${сумма}`), поэтому цвет
  ступени растёт вместе с суммой: три обычные ×4 на глазах становятся
  «редкой» ×12. Кольцо эпической появляется, когда сумма до неё доросла.
- **Шесть вариантов** (`MERGE_VARIANTS`, выбор случайный по весу): к центру,
  к старшей, снежный ком, парами, вихрь, всплытие. В турбо — только первые
  два и «парами»: цепочка переходов, сжатая по времени, превращается в
  мельтешение. Время сжимается на ту же долю, что и весь каскад (0,55), и
  упирается в потолок: 2,8 с обычно, 1,5 с в турбо.
- **Порядок слияний не бывает кучей**: между двумя «блоп» — не меньше
  `gapMs`, каждое слышно и видно отдельно. Звук растёт тоном
  (`bubbleMerge(k)`), общий пузырь раздувается по объёму (кубический
  корень), но не больше ×1,6 клетки.
- **Пузырь — внутри тела сферы** (`.orb__body`). Клетку двигает план, тело
  колышется от ударов (ось — откуда влился поглощённый), поглощаемый
  вытягивается к цели. Два трансформа на одном элементе дрались бы — отсюда
  обёртка. Камень внутри пузыря уменьшается свойством `scale`, а не
  `transform`: трансформ у камня занят его «дыханием».
- **Плёнка переливается прозрачностью** двух неподвижных конических слоёв с
  маской кольца. Не вращением: вращать внутри скруглённого overflow корпуса
  нельзя (см. «Купальскую ночь»).
- **Масштаб — от центра.** У упавшей клетки `transform-origin` внизу (она
  сплющивается о дно), и раздутый пузырь уезжал на пол-клетки вверх — общий
  лопался мимо жетона. Правило `.sboard.is-merging .sbcell--orb`
  возвращает центр; то же нужно было и старому полёту в жетон.
- **Безопасная зона**: план держит раздутый пузырь целиком в поле — сфера из
  крайней колонки при надувании отходит от кромки внутрь.
- **В бонусе** жетон с прошлым множителем уже стоит посередине. Пузыри
  сходятся и лопаются выше него (`stampShown`), иначе последние полсекунды
  общий висел бы под жетоном невидимым.
- **Лопание — склейка под вспышкой.** Плёнка расходится кольцом, брызги
  летят, камень уходит в точку, и через 70 мс ударом встаёт жетон с полной
  суммой (прежний `slam`: вспышка, монеты, тряска). Досыпка поля ждёт брызги.
- **Тап по автомату дожимает слияние** (`mergeSkip`): все пути доигрываются
  мгновенно, пузырь сразу лопается. Слияние обязано быть пропускаемым, как и
  счёт.
- Под `prefers-reduced-motion` слияния нет — сразу прежний сбор без
  движения.
- Тесты `orb-merge.test.ts`: ровно n−1 слияний и полная сумма в конце,
  поглощённый доплывает ровно до поглотившего и гаснет только у цели, никто
  не срезан кромкой, потолок времени, в турбо только быстрые варианты.

### Остальное, что поправлено в той же шлифовке (v2.44.0)

- **Сбор сфер синхронен с прилётом.** Счётчик прибавляет номинал сферы в тот
  кадр, когда она коснулась жетона (`ORB_ARRIVE` = 0,86 полёта — та же доля
  в CSS `orb-fly`), удар — после последней. Раньше сумма тикала полсекунды
  по часам, и при пяти сферах удар звучал, пока четыре были в воздухе.
  Жетона нет, пока не долетела первая: «×0» посреди поля — шум. Летящая
  сфера — над вуалью (`z-index` 5), под жетоном. После удара поле
  схлопывается на места сфер, как после выигрыша (`dropHoles`), а не
  досыпает символ из соседней клетки сверху.
- **Жетон «Каскада» наконец входит.** `.stamp.is-collect` целиком заменял
  анимацию жетона, и вход не играл вовсе. Уходит жетон с вуалью тоже
  анимацией (`is-out`), а не одним кадром.
- **Вуаль сбора лежит уже под сольным выходом** — иначе между соло и сбором
  проскакивал светлый кадр.
- **Оверлеи уходят, а не обрываются** — `lib/use-exit.ts`: тотем и плашка
  уровня; состояние страницы уже `null`, разметка доигрывает уход.
  Затемнение поля при выигрыше живёт всегда и гаснет прозрачностью.
- **`@keyframes combo-in` были потеряны в v2.35.0** — плашка цепочки
  возникала одним кадром. Строка «что сыграло» (`.hits`) использовала те же
  кадры, но центрирована иначе — у неё свои `hits-in`, иначе она уезжала бы
  на полширины.
- **«Слоты» трясутся и бьют тем же `juice.ts`, что «Каскад».** CSS-тряску
  снимал `onAnimationEnd` на корпусе, а он всплывает от каждой дочерней
  анимации: первая упавшая клетка обрывала тряску посреди размаха. Рычаг
  дёргается и от кнопки «Крутить».
- **Вспышка открывающего удара — только у церемонии** (от «ХОРОШЕГО»): её
  работа — спрятать сброс счётчика на ноль, а мелкому выигрышу сбрасывать
  нечего. Раньше экран мигал на каждом «ВЕРНУЛОСЬ».
- **Линии выплат.** Общий `stroke-dasharray: 200` при
  `vector-effect: non-scaling-stroke` меряется в пикселях экрана — V-линия
  (~350 px) обрывалась, правого плеча не было. Длину штриха страница считает
  по каждой линии; `pathLength` с non-scaling-stroke в Chromium делит неверно.
- **Колесо удачи.** Кривая стартовала на 47° за кадр — ровно сектор, и
  восемь секторов на такой скорости стояли или мерцали (эффект колеса в
  кино). Теперь замах, разгон до ~19° за кадр и долгое торможение. Щелчки
  — по секторам, прошедшим под язычком (редеют вместе со скоростью), язычок
  качается. Тень — отдельным неподвижным слоем: `drop-shadow` на самом диске
  крутилась вместе с ним.
- `AnimatedNumber` при смене цели посреди хода больше не прыгает назад:
  новый ход стартует с показанного значения. Монеты дождя падают с
  ускорением, а не тормозят у низа экрана. Вспышка взрыва выигрышной рамки —
  слоем по прозрачности вместо `filter: brightness()` в кадрах.

## UI v2 — the casino frame on the kit (wave 2 — K, 13.10.2026)

Files: `pages/casino-ui.tsx` (`useFit`/`fitStyles`, `useCasLayout`, `CasStat`, `KitIcon`, `CasDeck`,
`CasToggles`, `CasAutoPicker`, `CasBetPicker`) and `pages/casino.css` (page grid, deck, hall,
skins sheet, cash desk, session card, game sheets). Cabinet, reels, grid, skins and juice in
`theme.css` are untouched — only the frame around them changed.

- **The cabinet scales as one piece.** Reel motion moves in fixed pixel cells (Slots `CELL` 74,
  Cascade `SCELL` 68; `.cas.scatter { --scell: 68px }` beats the old 56-px landscape rule), so the
  cabinet keeps its old natural width (358 / 372 px) and `useFit` sets the CSS `scale` property
  (centre origin) to fill `.cas-stage` (`contain: size`). `scale` composes with juice.ts's
  `style.transform` shake; dust (`startDust`) coordinates are divided by the scale. Never give
  the cabinet a responsive width — the strip would run in the wrong pixels.
- **Layouts** — `data-lay` on `.cas` from `useCasLayout`: `tall` = phone portrait and tablet
  portrait (info / stage / deck in the thumb zone; tablet portrait: full-width stage, info | deck
  side by side under it); `wide` = phone landscape, tablet landscape, desktop (info | stage |
  deck). The page never scrolls (all 6 formats).
- **Nothing jumps** — checked with a Playwright script (not in the repo) that compares rects
  (info, stage, deck, balance, bet, spin, auto, turbo, bonus) across bet ±,
  Minus/Equal/Tab/Shift+Tab, Space spin, ante, auto 10 on/off.
  Bet value has a fixed width; the recent-spins row always exists (an empty well before the
  first spin); the bonus row hides with `visibility`; auto/turbo have a fixed width in `tall` and
  their key hint / counter are absolute badges — an inline key hint once pushed Spin by 18 px.
  Spin's own key hint is a corner badge too (inline it cut «DREHEN · 10» on desktop); Spin has no
  `overflow: hidden` — it clipped the kit focus frame (`.px-f::after` sits 3u outside).
- **Long words:** bonus plates have 2u side padding, the buy label wraps, the ante hint gets up
  to 3 lines (fr/it need them). Measure every language, not only ru: a text check over
  `.cas-deck *` / `.cas-info *` (box outside its button, or clipped with ellipsis/line-clamp).
- **Deck input:** Space/Enter (pad A) = spin (page `confirm`, scoped to the page); Tab/Shift+Tab
  (RB/LB), ←/→ (when nothing is focused) and −/+ (Minus/Equal/Numpad) = bet; X (pad Y,
  `inspect`) = auto sheet. Pad checked by firing `emitAction(…, 'gamepad', …, 'pad:0')`.
- **Dark surfaces:** the session card's peak sits on an ink plate (`--sesk-plate: var(--px-text)`
  resolved on the light card, then `.px-dark` on the plate) — rarity colours read only on dark.
  The hall note over the yard background is `.px-dark`.
- Touch targets ≥ `--gx-hit` (44 px): bet −/+/value, auto/turbo in landscape, bonus buttons;
  in `tall` the bet −/+/value are 24u (48 px on phones, critic R13). Landscape keeps 44 — the
  deck has no height to spare there (Spin ends 2 px above the edge).
- Hall: wallet (coins + casino level), two cards — Slots, Cascade — and a low row for «Каторга»
  (→ `/prison`, rank letter + tokens; it is a different game, not a third machine). A card is one
  button; «Играть» is drawn, not a nested button. The hall
  gets the screen height and no more (`.gs__main` / `.hall` flex 1 1 + `min-height: 0`); the
  cards share it and the art is what gives way: symbols are `object-fit: contain` in a definite
  grid cell. Phone landscape: the wallet is one line and the note is hidden — else «Play» fell
  under the edge. Watch `.gs__main` scrollHeight, not `#root`: the shell clips, it does not scroll.
  Long skin names («Nuit des citrouilles») get `.is-long` (> 10 letters): a step smaller, two
  lines. Fact values: ≥ 100 000 compact without decimals below a million («988 тыс.»), and
  `CasStat fit` steps the font down (`data-fit` 1–2, the coin goes at 2) instead of clipping —
  hall and in-game info (K2: the box is fixed by the grid, so a smaller font moves nothing). Stress values used for the
  check: spins 12 345, best 987 654, tokens 1 234 567, balance 123 456 789, in all 7 languages.
- Session card: on a low screen (`orientation: landscape` and `max-height: 520px`) it is two
  columns (peak + net | stats + buttons via `.sesk__col`, `display: contents` elsewhere); the
  veil row is `minmax(0, 1fr)` so `max-height: 100%` holds.
- Skins sheet: kit cards; the old `.skin-card` palette plate stays as the showcase (the relic's
  halo and shimmer live there); current skin = kit select frame; locked = `aria-disabled`
  (focusable, shows why). Cash desk: kit buttons with the row icon in front (a per-button coin
  did not fit «+1 000 000» on phones; the million is `fmtShort`); CreativeRow (another
  section's) takes a `className` prop (`px-btn px-f px-btn--iron`) — no override of its own CSS.
- Settings / auto / bet sheets of both games share `CasToggles` / `CasAutoPicker` /
  `CasBetPicker`; handlers stay in the pages. New kit icons: `auto`, `buzz` (vibration).
- Dead CSS of the old HUD, sheets and session card was removed from `theme.css` with a postcss
  script (not in the repo): a class counts as used if any src file mentions it or a template
  prefix `foo-${`; selectors with dead classes dropped, emptied rules removed. Do the same rather
  than deleting by eye.
- Not verified: a real phone / Telegram webview, a real gamepad, the big-win totem in the new
  frame (the rig reached only combo ×2).

### Critic fixes (wave 3 — K2, 13.10.2026)

- **SPIN → SKIP, never locked.** During a spin the button reads «Пропустить» (`is-skip`) and is
  live: tap 1 lands the reels (`slam`, `reelsDone`), tap 2 hurries the count (`hurry` =
  `SKIP_TEMPO` 0.5 + `skipCount()`). Space and pad A take the same path (`pressSpin`).
  `SKIP_GUARD_MS` 350: a spin tap right after a skip is ignored — without it the second tap of a
  double-tap started a new paid spin in Cascade. Economy untouched (`src/lib` diff empty).
- **Status / win line lives outside the scaled cabinet** (`.cas-status`): inside it shrank with
  `useFit` to 7.7–13.6 px. Now 17 px on phones (19 on tablet), fixed height 44/50 px.
- **Press feedback on touch:** `usePress` on `.cas-spin`, `.cas-bet__v`, hall cards / row and every
  header round (`CasRound` = `gx-round gx-round--dark` + `usePress`). `:active` alone never showed
  during a touch hold. Checked: `.is-down` within 2 frames at 4× CPU.
- **Phone landscape** (`useCasLying`): no GameTop on casino pages; a 4×44 tools row (`CasTools`) tops `.cas-info`.
  Info column 109u (was 92u) so the tools fit; the cabinet lost 6.6 % against K, still +33 %
  against before.
- **Hall wallet** has a fixed min-width (`11ch` + coin + gap): its rect is identical for
  9 990 … 999 999 999 on every format. Hall cards: art is a size container, symbols
  `min(100cqw, 100cqh)` — `aspect-ratio` with `min-height: auto` stretched the grid. Phone landscape:
  facts in one row, captions hidden, art column square (`calc(100cqh - 14u)`).
- **Records** use `fmtCompact` («1,2 млн», «988 тыс.»); `useFitText` refits on ResizeObserver AND
  a MutationObserver (text changes while the numbers roll). Tablet portrait stats:
  `auto minmax(min-content, 1fr) minmax(0, max-content)` — else the caption was cut.
- **Rules / paytable sheets** = `.cas-rules`: short lead + pictures; full texts inside
  `<details class="cas-more">` (44-px summary). Min font 17 px; rarity names are ink pills on the
  rarity colour (≥ 7:1) — rarity colour as text on parchment was 1.1:1.
- **Skins sheet** = `SkinCard` (art | name / state), names step down by a length class plus
  `@container skn` — measuring each name forced 13 layouts on open. The relic badge only when
  earned; a locked card shows lock + numbers + bar, same row height.
- Recent-spins row: 5 dashed empty chips before the first spin, fixed chip size — no jump on the
  first result. Under 375 px the tall balance is `--px-fs-head` (de «Guthaben» was cut).
- **Probe pitfalls:** the kit focus ring (`.px-f::after`, inset −3u) adds 6 px to `scrollWidth` —
  compare the content range, not sw/cw. After HMR Vite serves `/src/store.ts?t=…`: scripts must
  import the same URL the page did, or they patch a second store. Eruda (dev) sits top-right and
  steals taps / inflates long tasks — abort its requests in the stand.
- Juice tiers (R18) not touched by ruling.

### Critic round 2 (K2 / K2′, 19.10.2026)

- **The page never scrolls on any format** (`.gs__main` sh = ch, `scrollTop` 0 after a swipe, 320 …
  1440): `html[data-ff] .cas-page .gs__main { overflow: hidden }` beats the shell's landscape
  `overflow-y: auto`; `.slots.cas::before` (theme glow, 460 px tall) is `content: none`.
- **Light ground** `.cas-ground` (kit stone tile under a warm veil); the theme's `.slots-scene` is
  hidden on casino routes. Dark stays on the cabinet and the status plate (an opaque ink base under
  the skin's translucent plate). Near-black outside them 5–14 % of the screen.
- **Slots on tablet landscape / desktop:** two columns — stage | (info 2 × 2 on top of the deck);
  the cabinet is height-bound, 77–79 % of the height (tl 648 × 635, was ~11 % of the screen).
  Cascade keeps info | stage | deck (its board was height-bound already).
- **SKIP:** press 1 lands the reels AND sets `hurry` (`SKIP_TEMPO`); press 2 jumps to the final
  state. `SKIP_START_MS` 250: a press within 250 ms of the spin start is ignored (a 90-ms double
  tap kept the whole show). `SKIP_GUARD_MS` 350 stays. Rigged Slots ×660: 16.8 s; one press at
  0.3 s → 7.0 s; two → over 30 ms after the second. Cascade rig 12: 6.7 → 2.8 → 0.66 s.
- **Spin label size is one per language and width:** `useFitText` runs on the SET of plate labels
  (spin / skip / free / bonus / broke / stop stacked in one grid cell, only `.is-on` visible).
- **«Нет монет» explains:** a tap on the off plate → status `slots.status.broke` for 3 s + a
  1-art-px shake (`is-nope`) + `tapError()`.
- **Cascade deck:** Ante is a 44-px toggle at the right end of the bet row; «Купить бонус» is the
  third fact of the info strip (tall) / a row above the money (wide). Deck 178 px, cell 53 × 66 at
  390. Under 380 px the Cascade bet caption is hidden (the stepper + coin say it; it was «Став…»).
- **Sheets mount in `CasSheet`** (`openCasSheet(id)`): opening one no longer re-renders the page.
  The skins sheet renders the first cards, the rest are placeholders of the same grid until the next
  frame. Stand pitfall: a first CDP touch flips `data-input` and restyles the whole page — warm up
  with a touch elsewhere before timing a sheet (`WARM=1` in `ui5K/m/sheet2.mjs`).
- **Short phones (`max-height: 680px`, tall layout; 320 × 568, 360 × 640):** the info strip is
  level + one row of pictured facts (captions hidden, the recent-spins row hidden), Cascade's buy
  plate spans both strip rows (`fit-content(50%)`), gaps 2 u, deck padding 4 u / 6 u, thumb rows
  44 px. The hall hides its note and shows the card facts in one line. `max-width: 340px`: balance
  `--px-fs`, deck side padding 5 u, a long one-word card name (es «Tragaperras») `--px-fs`. p320
  Slots cabinet 143 × 118 → 236 × 195, Cascade 149 × 170 → 167 × 192 (still small: the
  shell's top takes 72 px).
- **Lever:** `usePress` on it (the knob drops 1 art px on pointerdown); hit column `::after`
  `max(52px, 48px / var(--fit))` — `--fit` is the cabinet's scale, set by `fitStyles`. 48–128 px on
  every format, 43 at 320 (the cabinet's own edge clips it; wider would cover the reels).
- **Type:** three sizes per screen in the frame (caption `sm`, body `fs`, display `big`; the
  GameTop title is the shell's): hall facts `fs`, wallet and tablet card titles `big`, the
  «Каторга» row title `fs`, tablet balance / Spin `big` (hero was a fourth size). Coins follow
  their digits (`0.9em` in facts, `1.1em` in the buy price).
- **Skins sheet note:** one line «🔒 Реликвия — за выигрыш ×200 одним спином»
  (`slots.skin.relicLock`) + the Twemoji credit line (`slots.skin.credit`); the old 23-word
  `slots.skin.note` is the tooltip.
- Probe scripts of this round: `scratchpad/ui5K/m/` (`rects.mjs` = block rects + clipped text,
  `stage2.mjs`, `item7.mjs`, `skipprobe.mjs`, `spinlbl.mjs`, `broke.mjs`, `lever.mjs`,
  `sheet2.mjs`, `fsz.mjs`, `iconsz.mjs`; `lib.mjs` has p320 / p640 / pse / p430).
