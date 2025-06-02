# Coco Instruments

Веб-приложение для финансовых и геодезических расчетов.

## Установка

```bash
npx create-react-app coco-instruments
cd coco-instruments
npm install react-router-dom
npm install -g @railway/cli
```

## Настройка

1. Создайте `.env` файл:
```bash
cp .env.example .env
```

2. Настройте PostgreSQL на Railway (см. `database/SETUP.md`)

3. Выполните SQL схему:
```bash
railway run psql $DATABASE_URL < database/schema.sql
```

## Запуск локально

```bash
npm start
```

## Деплой на Railway

```bash
railway login
railway link
railway up
```

## Структура проекта

```
coco-instruments/
├── public/
│   ├── index.html
│   ├── manifest.json
│   └── sw.js
├── src/
│   ├── components/
│   ├── pages/
│   ├── styles/
│   └── utils/
├── database/
│   ├── schema.sql
│   └── SETUP.md
├── railway.toml
└── .env.example
```

## Технологии

- React 18
- React Router
- Tailwind CSS
- PostgreSQL
- Railway.app

## PWA

Приложение поддерживает установку как нативное приложение на мобильных устройствах.