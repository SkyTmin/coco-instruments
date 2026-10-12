/** Shared words: buttons, toggles, units. Source of truth — keep `as const`. */
export const common = {
  back: 'Назад',
  close: 'Закрыть',
  cancel: 'Отмена',
  ok: 'Готово',
  yes: 'Да',
  no: 'Нет',
  on: 'Вкл',
  off: 'Выкл',
  auto: 'Авто',
  soon: 'Скоро',
  settings: 'Настройки',
  loading: 'Загрузка…',
  level: '{n} ур.',
  coins: { one: '{n} монета', few: '{n} монеты', many: '{n} монет', other: '{n} монеты' },
} as const;
