# Деплой на VPS (Ubuntu) + подключение бота

Приложение — Telegram Mini App с небольшим Node/Express backend. **Caddy**
принимает HTTPS, проксирует всё в Express, а Express раздаёт SPA, `/api/*`
и `/uploads/*`. Файлы заметок хранятся на VPS в `/var/lib/coco/uploads`.

Раздаём приложение по **HTTPS** через **Caddy** (автоматический сертификат
Let's Encrypt) на хосте вида `<ваш-ip>.nip.io`.
Telegram требует HTTPS с валидным сертификатом, а у голого IP его не получить —
`nip.io` бесплатно даёт имя, указывающее на ваш IP.

## 1. Развернуть приложение (одна команда на сервере)

Зайдите на VPS по SSH под `root` и выполните:

```bash
curl -fsSL https://raw.githubusercontent.com/SkyTmin/coco-instruments/prod/deploy/setup.sh | bash
```

Скрипт сам: добавит swap, поставит Node 20 и Caddy, скачает код, соберёт его и
поднимет HTTPS + systemd-сервис `coco`. В конце выведет ваш адрес, например:

```
https://31.184.198.91.nip.io
```

> Если открыть этот адрес в обычном браузере — будет надпись «Откройте в Telegram».
> Это нормально: приложение работает только внутри Telegram.

## 2. Подключить бота (@coco_instruments_bot)

Выполните **один раз** (с любого устройства с интернетом), подставив токен бота
вместо `<BOT_TOKEN>` и свой адрес из шага 1:

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Coco","web_app":{"url":"https://31.184.198.91.nip.io/"}}}'
```

Ответ `{"ok":true,"result":true}` — готово. Откройте чат с ботом → кнопка меню
(слева от поля ввода) запустит приложение.

Альтернатива без командной строки: **@BotFather → /mybots → @coco_instruments_bot
→ Bot Settings → Menu Button** и вставить адрес.

## 3. Обновление после новых изменений

```bash
sudo bash /opt/coco/deploy/redeploy.sh
```

## 3.1. Бэкапы и перенос на новый сервер

Все данные лежат в `/var/lib/coco` (`store/` — данные пользователей, `uploads/` —
фото, `reminders.json`, `admin.json`).

- **Ежедневный бэкап** — systemd-таймер `coco-backup.timer` (в 03:30): архивирует
  `/var/lib/coco`, хранит последние 14 копий в `/var/lib/coco/backups` и присылает
  архив администратору в Telegram.
- **Команды бота:** `/backup` — сделать и прислать копию прямо сейчас; `/id` —
  узнать свой chat id. Первый, кто отправит `/backup`, становится получателем
  бэкапов (или задаётся секретом `ADMIN_CHAT_ID`).
- **Перенос на новый сервер:** разверни новый сервер (`setup.sh`), затем
  `sudo bash /opt/coco/deploy/restore.sh <архив>.tar.gz` — все данные вернутся.

Опциональный секрет GitHub Actions **`ADMIN_CHAT_ID`** — твой Telegram chat id
(узнать через `/id`), чтобы бэкапы шли тебе автоматически.

## 4. Как теперь работают файлы заметок

- Frontend сжимает фото на клиенте и отправляет `POST /api/notes/attachments`.
- Express сохраняет файл в `/var/lib/coco/uploads` и возвращает URL вида
  `/uploads/<id>-photo.jpg`.
- В заметке хранится только метаданные + URL, а не весь base64-файл.
- Caddy проксирует `/uploads/*` в Express, поэтому ссылки открываются и
  скачиваются с того же HTTPS-домена Telegram Mini App.
- Текущий лимит backend: `MAX_UPLOAD_BYTES=3145728` (3 МБ на сохранённый файл).
  Фото можно выбрать крупнее: клиент пытается сжать исходник до лимита.

Для будущего раздела «Одежда» используйте тот же endpoint или вынесите общий
upload helper. Если понадобится много оригинальных фото без сжатия, лучше
подключить S3-совместимое хранилище или Supabase Storage; Telegram CloudStorage
для этого не подходит. У CloudStorage лимит порядка 1024 ключей по 4096 символов
на пользователя для бота, то есть это место для настроек/малых JSON, а не
фотогалерея.

## Для Клауда / второго агента

Не кладите фото в Telegram CloudStorage или localStorage, кроме fallback в dev.
Правильный путь:

1. Подготовить файл на клиенте (для фото желательно сжать).
2. Отправить JSON:

```http
POST /api/notes/attachments
Content-Type: application/json

{
  "name": "coat.jpg",
  "type": "image/jpeg",
  "size": 123456,
  "dataUrl": "data:image/jpeg;base64,..."
}
```

3. Сохранить в клиентском состоянии ответ:

```json
{
  "id": "...",
  "name": "coat.jpg",
  "type": "image/jpeg",
  "size": 123456,
  "url": "/uploads/..."
}
```

4. Для отображения использовать `url`, для старых/dev-вложений fallback на
`dataUrl`.

Deploy secrets в GitHub Actions:
- `VPS_HOST`: `31.184.198.91`
- `VPS_PASSWORD`: пароль root от VPS (fallback, если нет SSH-ключа)
- `BOT_TOKEN`: токен Telegram-бота
- опционально `VPS_SSH_KEY`: приватный SSH-ключ (**рекомендуется** вместо пароля —
  добавь публичную часть в `~/.ssh/authorized_keys` на сервере, приватную — сюда;
  деплой и бэкап автоматически предпочтут ключ паролю)
- опционально `ADMIN_CHAT_ID`: твой Telegram chat id — владелец бэкапов. Если задан,
  «первый написавший `/backup`» уже не сможет присвоить бэкапы (важно, если бота может
  писать не только владелец). Узнать id: команда `/id` боту.
- опционально `DOMAIN`: свой домен вместо `31.184.198.91.nip.io`

## Заметки
- Сертификат Caddy выпускает и продлевает сам (нужны открытые порты 80 и 443).
- Хотите свой домен вместо nip.io? Наведите A-запись на IP и запустите:
  `DOMAIN=app.example.com bash deploy/setup.sh` — затем обновите URL в шаге 2.
- **Безопасность:** после настройки рекомендую сменить пароль root на сервере
  (`passwd`) — он засветился в переписке.
