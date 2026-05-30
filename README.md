# Coco — Telegram Mini App

Личный Telegram Mini App. На главном экране — карточки разделов. Сейчас реализованы:

- **Финансы** — расходы (разовые платежи, кредиты, рассрочки), накопления, статистика и графики.
- **Одежда** — заглушка (в разработке).

Приложение рассчитано на одного пользователя (вас). Логина нет — данные хранятся в
**Telegram CloudStorage** (синхронизируются между вашими устройствами), а в браузере —
в `localStorage`.

## Стек

- **Vite 6 + React 18 + TypeScript**
- **[@tma.js/sdk-react](https://docs.telegram-mini-apps.com/)** — Telegram SDK (init, тема, BackButton, CloudStorage, haptics)
- **[@telegram-apps/telegram-ui](https://github.com/Telegram-Mini-Apps/TelegramUI)** — нативная база (AppRoot)
- **react-router-dom** (HashRouter) · **zustand** (состояние) · **recharts** (графики)
- **eruda** — мобильная консоль в режиме разработки

## Скрипты

```bash
npm install        # установка зависимостей
npm run dev        # дев-сервер (http://localhost:5173) с моком Telegram-окружения
npm test           # юнит-тесты финансового движка (vitest)
npm run build      # проверка типов + продакшн-сборка в dist/
npm run preview    # предпросмотр продакшн-сборки
npm start          # express-сервер, отдаёт dist/ (для хостинга)
```

В браузере окружение Telegram **мокается** (`src/mockEnv.ts`), поэтому приложение
открывается как обычная веб-страница. В продакшн-сборке мок вырезается, и приложение
работает только внутри Telegram (вне его покажет «Откройте приложение в Telegram»).

## Структура

```
src/
  main.tsx · Root.tsx · App.tsx     # точка входа, роутинг, тема, BackButton
  init.ts · mockEnv.ts              # инициализация SDK / мок для браузера
  theme.css                         # бренд Coco (бежевый/коричневый) + светлая и тёмная темы
  types.ts                          # доменные типы (Obligation, SavingsGoal …)
  store.ts                          # zustand-стор + сохранение в Storage
  charts.tsx                        # графики Recharts (тема-зависимые)
  lib/
    finance-calc.ts(+.test.ts)      # движок расчётов (кредит/рассрочка/разовый) + тесты
    storage.ts                      # CloudStorage (с чанкингом) + localStorage
    format.ts · date.ts · haptics.ts · id.ts
  components/                       # icons, ui-кит (Screen, Fab, Sheet, ProgressBar …)
  pages/                            # HomePage, ClothingPage, finance/*
legacy/                             # прежнее vanilla-PWA (сохранено, не используется сборкой)
```

## Финансовая модель

| Тип | Что вводите | Как считается |
|-----|-------------|----------------|
| **Разовый** | сумма, дата | итог = сумма, переплата 0 |
| **Кредит** | сумма, платёж/мес, срок, (ставка%) | итог = платёж × срок; переплата = итог − сумма; ставка ≈ выводится из аннуитета |
| **Рассрочка** | сумма, переплата всего, срок | итог = сумма + переплата; платёж = итог ÷ срок |

«Выплачено» считается по реально внесённым платежам (предварительные не учитываются).
Подробности и проверенный пример (кредит 100 000 ₽ / 12 мес) — в `src/lib/finance-calc.test.ts`.

## Запуск внутри Telegram (для разработки)

1. `npm run dev` (сервер слушает на `0.0.0.0:5173`).
2. Прокиньте HTTPS-туннель: `ngrok http 5173` (Telegram требует HTTPS).
3. В **@BotFather**: создайте бота → `/newapp` (или *Bot Settings → Menu Button*) и укажите
   URL мини-аппа = адрес из ngrok.
4. Откройте бота в Telegram (телефон/десктоп) и запустите мини-апп.
   На телефоне доступна консоль eruda для отладки.

## Деплой (когда выберете хостинг)

Сборка статическая: `npm run build` → папка `dist/`. Варианты:

- **Любой Node-хост** (Railway/Render/VPS): запускайте `npm start` — `server.js` отдаёт `dist/`
  с SPA-фоллбэком. `railway.json` уже настроен (`npm run build` → `npm start`).
- **Статический хостинг** (Vercel/Netlify/Cloudflare/GitHub Pages): задеплойте `dist/`.
  Если хостинг под под-путём — поменяйте `base` в `vite.config.ts`.

После деплоя укажите продакшн-URL в @BotFather как URL мини-аппа.
```
