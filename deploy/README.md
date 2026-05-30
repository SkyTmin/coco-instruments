# Деплой на VPS (Ubuntu) + подключение бота

Приложение — статический сайт. Раздаём его по **HTTPS** через **Caddy**
(автоматический сертификат Let's Encrypt) на хосте вида `<ваш-ip>.nip.io`.
Telegram требует HTTPS с валидным сертификатом, а у голого IP его не получить —
`nip.io` бесплатно даёт имя, указывающее на ваш IP.

## 1. Развернуть приложение (одна команда на сервере)

Зайдите на VPS по SSH под `root` и выполните:

```bash
curl -fsSL https://raw.githubusercontent.com/SkyTmin/coco-instruments/claude/intelligent-noether-bcnYS/deploy/setup.sh | bash
```

Скрипт сам: добавит swap, поставит Node 20 и Caddy, скачает код, соберёт его и
поднимет HTTPS. В конце выведет ваш адрес, например:

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

## Заметки
- Сертификат Caddy выпускает и продлевает сам (нужны открытые порты 80 и 443).
- Хотите свой домен вместо nip.io? Наведите A-запись на IP и запустите:
  `DOMAIN=app.example.com bash deploy/setup.sh` — затем обновите URL в шаге 2.
- **Безопасность:** после настройки рекомендую сменить пароль root на сервере
  (`passwd`) — он засветился в переписке.
