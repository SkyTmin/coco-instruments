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
- **Известная незакрытая проблема:** сервер не ходит НАРУЖУ к `api.telegram.org`
  (оранжевое облачко на это не влияет — оно только про входящие). Из-за этого
  бот не отвечает, а ежедневные бэкапы оборвались 12.09.2026. Кандидат на
  решение — отправлять через GitHub Actions, которые уже работают посредником
  (`GH_DISPATCH_TOKEN`, `reminders.yml`).
- Диагностика, не требующая доступа к серверу: workflows «DNS check» и
  «Server check (связь с Telegram)» — оба только читают.

## Conventions

- Commit messages in this repo are short and in Russian (e.g. `feat(calc): …`).
- Do not commit secrets. `dist/` and `node_modules/` are build artifacts (git-ignored).
- The app runs inside Telegram's webview (mobile-first); the calculator pins itself to
  the viewport and uses pointer gestures — test touch behaviour, not just desktop.
- **Bump the version on every deploy.** `src/version.ts` holds `APP_VERSION` — raise it
  for each user-visible release and name it in the commit. It's shown in the home
  screen's bottom corner (with the Vite-injected build time) so the user can confirm a
  fresh build actually loaded (vs. a stale PWA cache).
