# Coco Instruments

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Telegram Mini App](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4.svg)
![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-d97757.svg)

An open-source, self-hostable **Telegram Mini App** — a personal "instruments"
suite that bundles several everyday tools into one mobile-first app: personal
**finance**, a **notes** section with a wiki-linked knowledge **graph**, a
lightweight **people / relationships** tracker, a **wardrobe / lookbook**, and a
gesture-driven **calculator**.

> **Live:** opens inside Telegram (the bot's menu button). Outside Telegram it
> politely shows an "Open in Telegram" screen, because it relies on the Telegram
> SDK for theme, storage and user identity.

The whole app is designed and built **in the open**, end to end, with
[Claude Code](https://claude.com/claude-code).

---

## Features

- **Finance** — one-off payments, credits and installments, savings goals, and
  theme-aware charts. The money math (annuity rate inference, overpayment,
  "paid so far") lives in a typed, unit-tested engine (`src/lib/finance-calc.ts`).
- **Notes + knowledge graph** — chat-style notes with photos, `[[wiki-links]]`
  and `#tags`, plus an interactive, force-directed graph (Obsidian-style) with
  pan/zoom/pinch, a local "around this node" mode, context-aware filters, and
  node highlighting.
- **People** — a small personal CRM: people, relationships, gifts, promises,
  and conversation/meeting ideas, all linkable from notes.
- **Wardrobe** — clothing items, outfits ("lookbook"), wishlist, size helpers
  and comparisons.
- **Calculator** — a pointer-gesture calculator tuned for touch.

## Tech stack

- **Frontend:** Vite 6 · React 18 · TypeScript (strict) · Zustand ·
  React Router (HashRouter) · Recharts · `vite-plugin-pwa`
- **Telegram:** [`@tma.js/sdk-react`](https://docs.telegram-mini-apps.com/) (init,
  theme, BackButton, viewport, haptics) · `@telegram-apps/telegram-ui`
- **Backend:** Node + Express (`server.js`) — serves the built SPA and a small
  `/api`, authenticating requests with Telegram `initData`
  (`@telegram-apps/init-data-node`).
- **Quality:** Vitest unit tests · ESLint + Prettier in CI.

## Architecture

```
Telegram client ──> Express (server.js) ──> serves dist/ (SPA) + /api
                                       └──> per-user data on the host
                                            (/var/lib/coco: store/, uploads/)
```

- The frontend is a static SPA built by Vite; in the browser the Telegram
  environment is **mocked** (`src/mockEnv.ts`, tree-shaken out of production), so
  you can develop it as an ordinary web page.
- Data is stored **server-side per Telegram user** (JSON on the host); photos are
  uploaded to the server. Requests are validated with Telegram `initData`.
- **Continuous deployment:** every push to the `prod` branch triggers a GitHub
  Action that SSHes into the VPS, builds **off to the side and swaps atomically**
  (zero downtime), runs a `/api/health` check, restarts the service, and
  re-points the Telegram bot's menu button.
- **Backups:** a daily systemd timer archives the data dir, keeps the last 14
  copies, and sends the archive to the admin via the bot (`/backup`, `/id`).

## Develop locally

```bash
npm install        # install dependencies
npm run dev        # dev server (http://localhost:5173), Telegram env mocked
npm test           # unit tests (Vitest)
npm run build      # typecheck (tsc --noEmit) + production build to dist/
npm run preview    # preview the production build
npm start          # Express server: serves dist/ + /api
npm run lint       # ESLint
```

### Run it inside Telegram

1. `npm run dev` (listens on `0.0.0.0:5173`).
2. Expose an HTTPS tunnel: `ngrok http 5173` (Telegram requires HTTPS).
3. In **@BotFather**: create a bot → `/newapp` (or *Bot Settings → Menu Button*)
   and set the Mini App URL to your ngrok address.
4. Open the bot in Telegram (mobile or desktop) and launch the Mini App. On
   mobile, the in-page `eruda` console is available for debugging.

## Deploy

Production runs on a VPS and deploys automatically on push to **`prod`**
(GitHub Actions → `deploy/setup.sh`). The build is static (`npm run build` →
`dist/`) and served by `server.js`; see `deploy/` for the VPS setup, redeploy,
and restore scripts. Required Actions secrets (`VPS_HOST`, `VPS_PASSWORD`,
`BOT_TOKEN`, …) are documented in `deploy/README.md`; without them the workflow
stays green and simply skips.

## Finance model

| Type | You enter | How it's computed |
|------|-----------|-------------------|
| **One-off** | amount, date | total = amount, overpayment 0 |
| **Credit** | amount, monthly payment, term, (rate %) | total = payment × term; overpayment = total − amount; rate ≈ inferred from the annuity |
| **Installment** | amount, total overpayment, term | total = amount + overpayment; payment = total ÷ term |

"Paid so far" counts only real, recorded payments. A worked example
(a 100 000 ₽ / 12-month credit) is verified in `src/lib/finance-calc.test.ts`.

## Project layout

```
src/
  main.tsx · Root.tsx · App.tsx     # entry, routing, theme, BackButton, keyboard
  init.ts · mockEnv.ts              # Telegram SDK init / browser mock
  store.ts · types.ts               # Zustand store + domain types
  theme.css · charts.tsx            # design system (light/dark) + Recharts
  lib/                              # finance-calc, notes-graph, storage, … (+ tests)
  components/                       # icon set, UI kit (Screen, Sheet, ConfirmDialog …)
  pages/                            # home, finance/*, notes, people/*, clothing/*, calculator
server.js · app.js                  # Express host + API
deploy/                             # VPS setup / redeploy / restore + GitHub Action
tests/                              # API tests (supertest)
legacy/                             # the earlier vanilla PWA, kept for reference
```

## License

[MIT](./LICENSE) © Shamil ([@SkyTmin](https://github.com/SkyTmin))

---

## По-русски

**Coco Instruments** — открытый, самостоятельно хостящийся **Telegram Mini App**:
несколько личных инструментов в одном приложении — **финансы** (платежи, кредиты,
рассрочки, накопления, графики), **заметки** с вики-ссылками и интерактивным
**графом связей**, лёгкий трекер **людей/отношений**, **гардероб** (вещи и образы)
и жестовый **калькулятор**.

- **Фронт:** Vite + React + TypeScript (strict) + Zustand. **Бэк:** Node/Express
  (`server.js`), отдаёт собранный SPA и `/api`, проверяет запросы по Telegram
  `initData`.
- Данные хранятся **на сервере по пользователю** (JSON на хосте, фото — загрузкой).
- **Деплой автоматический:** пуш в ветку `prod` → GitHub Action собирает на VPS со
  сборкой «в сторону» и атомарной заменой (без простоя), проверяет здоровье и
  перенацеливает кнопку бота. Ежедневные бэкапы (хранит 14, шлёт админу через бота).
- Запуск локально: `npm install` → `npm run dev` (окружение Telegram мокается),
  `npm test`, `npm run build`. Запуск внутри Telegram — через `ngrok` и @BotFather.

Приложение целиком разрабатывается в открытую с помощью
[Claude Code](https://claude.com/claude-code).
