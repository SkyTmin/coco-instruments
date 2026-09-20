# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

Coco Instruments — a Telegram Mini App (React + Vite + TypeScript, Zustand store,
HashRouter) with a small Node/Express backend (`server.js`). Sections: finance,
notes (+ graph), people, clothing/wardrobe, and a gesture-driven calculator.

## Commands

- `npm run dev` — Vite dev server.
- `npm run build` — typecheck (`tsc --noEmit`) + production build. Run before pushing.
- `npm test` — Vitest unit tests (`src/lib/*.test.ts`).
- `npm start` — run the Express server (serves `dist/` + `/api`).

## Deployment & branches — READ THIS BEFORE PUSHING

Production is a VPS, deployed **automatically by GitHub Actions**.

- **The `prod` branch is production for this React app.** `.github/workflows/deploy.yml`
  triggers on every push to `prod`: it SSHes into the VPS, runs `deploy/setup.sh` (which
  resets the server's checkout to `origin/prod`, rebuilds, and restarts the `coco`
  service), then repoints the Telegram bot's menu button. **Nothing deploys from any
  other branch.**
- **⚠️ `main` is NOT this app.** The `main` branch holds an old, unrelated version of
  Coco (vanilla HTML/JS — `coco-money.html`, `debts.html`, `scale-calculator.html`, …)
  with a separate history. Do not deploy from it, merge into it, or overwrite it.
- **To ship a change, get it onto `prod`.** Each web session is given its own working
  branch (e.g. `claude/<name>`). That branch does **not** auto-deploy. When the work is
  approved, fast-forward / merge it into `prod` and push `prod` — the Action does the
  rest.
- **Ship without asking.** The owner has no other way to try a change than on the live
  bot, so every finished piece of work goes straight to `prod`: build, test, bump the
  version, commit to the session branch, fast-forward `prod`, push. Do **not** stop to
  ask for confirmation — that is a standing instruction from the owner.
- Required GitHub Actions secrets (already configured): `VPS_HOST`, `VPS_PASSWORD`,
  `BOT_TOKEN` (optional: `VPS_USER`, `DOMAIN`, `GH_TOKEN`, `ADMIN_CHAT_ID`). Without
  them the workflow stays green and simply skips.
- **Data lives in `/var/lib/coco`** (`store/` = per-user app data, `uploads/` = photos,
  `reminders.json`, `admin.json`) — outside the app checkout, so deploys never touch it.
  A daily systemd timer (`coco-backup.timer`) archives it, keeps the last 14 copies in
  `/var/lib/coco/backups`, and sends the archive to the admin via the bot. Bot commands:
  `/backup` (send a copy now), `/id` (get your chat id). Restore on a new box:
  `sudo bash deploy/restore.sh <archive>.tar.gz`.
- The branch name is referenced in several places — keep them in sync if it is ever
  renamed: `.github/workflows/deploy.yml` (trigger + `BRANCH`), `deploy/setup.sh`,
  `deploy/redeploy.sh`, `deploy/README.md`, and `server.js` (`GH_REF`).
- Manual redeploy on the box: `sudo bash /opt/coco/deploy/redeploy.sh`. Manual run from
  GitHub: Actions → "Deploy to VPS" → "Run workflow" (`workflow_dispatch`).

> По-русски: прод живёт на VPS и выкатывается сам при пуше в ветку **`prod`** (GitHub
> Action «Deploy to VPS» — собирает на сервере и перенацеливает кнопку бота). Ветка
> **`main` — это СТАРОЕ приложение** (Coco на чистом HTML/JS), её не трогаем. Любая
> рабочая ветка сессии в прод НЕ едет — чтобы задеплоить, изменения нужно влить в
> `prod` и запушить её. **Подтверждения спрашивать не надо** — владелец проверяет
> только в проде, поэтому готовую работу сразу катим туда.

## Сеть: домен, Cloudflare и Telegram — НЕ ТРОГАТЬ НАУГАД

Сервер стоит на российском IP (`31.184.198.91`, handy.host). Telegram в России
заблокирован, и из этого следует всё остальное:

- **Домен `coco-instruments.ru` должен быть ЗА прокси Cloudflare (оранжевое
  облачко).** Обе записи `A` — апекс и `www` — в режиме Proxied, SSL/TLS = Full.
  Проверено 19.09.2026: с серым облачком у пользователей с заграничным VPN
  вместо приложения был белый экран (соединение устанавливается, тело ответа
  не приходит), с оранжевым — всё грузится.
- **Почему так, хотя раньше было наоборот.** В коде долго жил шаг, который
  принудительно переводил домен в серый режим: прокси Cloudflare в России
  режет ответы примерно на 16 КБ, и для тех, кто ходит из России напрямую,
  серый режим действительно лучше. Но Telegram в России закрыт — значит **все**
  пользователи мини-приложения приходят через VPN с заграничными выходами, а
  для них верно ровно обратное. Старое рассуждение осталось в комментариях и
  легко уводит не туда: не верьте им, верьте этому абзацу.
- Деплой режим прокси больше не меняет, только докладывает. Переключить
  вручную — workflow «DNS check (Cloudflare grey cloud)».
- **Вебхук запоминает IP, а не имя.** Telegram резолвит домен один раз, при
  регистрации, и сам DNS не перечитывает; `setWebhook` с тем же адресом
  отвечает «Webhook is already set» и ничего не меняет. После переключения
  домена на Cloudflare он из-за этого продолжал ходить на старый IP и получать
  «Connection timed out». Лечится `deleteWebhook` + `setWebhook` с явным
  параметром `ip_address` — деплой теперь вычисляет адрес из живого DNS на
  каждом прогоне и передаёт его. Признак беды: в `getWebhookInfo` поле
  `ip_address` затёрто маской секретов (значит совпадает с `VPS_HOST`, то есть
  указывает мимо Cloudflare). Когда всё верно, там видны настоящие цифры
  адреса Cloudflare. Проверено 19.09.2026 — после этого вход на сайте ожил.
- **Сервер не ходит НАРУЖУ к `api.telegram.org`** — и, видимо, не будет, пока
  стоит в России. Это не чинится оранжевым облачком (оно только про входящие),
  зато обходится: всё, что сервер отправляет сам, доставляют раннеры GitHub.
  Они достают и VPS, и Telegram. `reminders.yml` шлёт напоминания,
  `backup.yml` забирает архив по SSH и отправляет копию. Ответы бота на команды
  идут третьим путём — в теле ответа на сам вебхук (`res.json({method: ...})`),
  поэтому работают без исходящих. Из этого следует ловушка: **рабочий бот НЕ
  доказывает, что исходящие живы** — на этом я и обжёгся 19.09.2026.
- **С сервера бывает не открывается и сам github.com.** 19.09.2026 деплой
  упал на `Failed to connect to github.com port 443 after 129563 ms`, и прод
  застрял на прошлой версии, хотя ветка уехала вперёд. Через семь минут
  тот же деплой прошёл — то есть сеть моргает, а не закрыта совсем.
  Признак: в логе прогона «Deploy to VPS» шаг SSH висит минуты и падает с
  `Process exited with status 128`. Деплой это теперь переживает: git
  пробуется трижды с таймаутом 45 с, а раннер на каждом прогоне кладёт на
  сервер архив с кодом (`/tmp/coco-src.tar.gz`) и разворачивает его, если
  git не смог. **Если правите деплой — не возвращайте серверу роль того,
  кто ходит за кодом сам.**
- **GitHub молча отключает workflow с расписанием**, если в репозитории долго
  нет коммитов (`state: disabled_inactivity`). 12.09.2026 так разом умерли
  `backup.yml` и `reminders.yml` — копии пропали на неделю, а отсутствие
  напоминаний вообще никто не заметил. Симптом со стороны приложения: запрос
  бэкапа возвращает 422 «Cannot trigger a workflow_dispatch on a disabled
  workflow». Деплой теперь на каждом прогоне проверяет оба и включает обратно
  (нужен `permissions: actions: write`), так что само это больше не всплывёт.
- **Диагностика для владельца — в приложении:** «Игры» → ⚙ → низ блока «Касса».
  Показывает связь с Telegram, свободное место, дату последней копии и причину
  прошлого сбоя. Именно она вывела на 422 после часа гаданий — начинайте
  отсюда, а не с логов.
- Диагностика, не требующая доступа к серверу: workflows «DNS check» и
  «Server check (связь с Telegram)» — оба только читают.

## «Сочность» и редкость в играх — как это устроено

Правила игр не менялись; менялось только то, сколько игра о них рассказывает.

- **Сфера — это СВОЙСТВО клетки, а не предмет поверх поля.** В `BoardCell`
  есть поле `orb`: если оно заполнено, клетка рисует самоцвет вместо символа.
  Никакого отдельного слоя нет — камень лежит в колонке наравне с символами.
  До этого он был абсолютно позиционированным соседом колонок и, сколько его
  ни подгоняй по координатам, читался наклейкой: владелец заметил это трижды
  подряд. Два правила, без которых иллюзия снова сломается: **ключ клетки с
  камнем зависит только от места и номинала** (иначе React пересоздаёт её
  между звеньями и появление проигрывается заново), и **`fall` у неё всегда
  ноль** (колонка съезжает, камень остаётся).
- **У `.sboard__col` намеренно НЕТ `overflow: hidden`.** Клипает само поле.
  Верните клипание колонке — и самоцвет при сборе обрежется на её границе,
  когда полетит к счётчику в центре; ровно из-за этого он когда-то и жил
  отдельным слоем.
- **Клетка под сферой в восьмёрку не идёт** — в этом размен: сфера платит,
  но загромождает поле и укорачивает цепочку. Именно поэтому таблица выплат
  может быть выше, чем была бы без этого. Проверяется тестом «закрытая сферой
  клетка не попадает ни в один выигрыш».
- **Сферы копятся всю последовательность и срабатывают ОДИН раз, в конце**,
  умножая весь её выигрыш; складываются, а не перемножаются. Падают всегда —
  и на спине, который не сыграл. Раньше они умножали каждое звено отдельно и
  выбрасывались без выигрыша: сферу можно было не увидеть за сотню спинов.
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
- **`src/lib/juice.ts` — приёмы, а не библиотека.** Стоп-кадр (пауза читается
  как удар, её длина — как сила), кадр-вспышка (прячет склейку: всё, что
  меняется во время вспышки, читается как ею вызванное), тряска по Айзерло
  (копится «травма», смещение ∝ её КВАДРАТУ, гладкий шум вместо
  `Math.random` — случайное число на кадр выглядит как сломанный телевизор).
  Трясётся корпус автомата, а не страница: внутри Telegram дёрганье всего
  экрана читается как баг вебвью.
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

## Conventions

- Commit messages in this repo are short and in Russian (e.g. `feat(calc): …`).
- Do not commit secrets. `dist/` and `node_modules/` are build artifacts (git-ignored).
- The app runs inside Telegram's webview (mobile-first); the calculator pins itself to
  the viewport and uses pointer gestures — test touch behaviour, not just desktop.
- **Bump the version on every deploy.** `src/version.ts` holds `APP_VERSION` — raise it
  for each user-visible release and name it in the commit. It's shown in the home
  screen's bottom corner (with the Vite-injected build time) so the user can confirm a
  fresh build actually loaded (vs. a stale PWA cache).
