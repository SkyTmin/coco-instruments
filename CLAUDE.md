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
  rest. Always confirm with the user before pushing to `prod` (it deploys to production
  and retargets the bot).
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
> `prod` и запушить её. Перед пушем в `prod` спрашивай подтверждение — это деплой в прод.

## Conventions

- Commit messages in this repo are short and in Russian (e.g. `feat(calc): …`).
- Do not commit secrets. `dist/` and `node_modules/` are build artifacts (git-ignored).
- The app runs inside Telegram's webview (mobile-first); the calculator pins itself to
  the viewport and uses pointer gestures — test touch behaviour, not just desktop.
