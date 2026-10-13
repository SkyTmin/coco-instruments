/** Owner-only cash desk and backup health (CashDesk, inside the mine settings). */
export const cash = {
  title: 'Касса',
  hintShort: 'Отдачу автомата это не меняет',
  meta: 'монеты виртуальные',
  hint: 'Отдача автомата от этого не меняется: спины по-прежнему считает честный ГСЧ, и проигрывать тоже будет. Это просто способ не ждать ежедневных бонусов.',
  telegram: 'Связь с Telegram',
  linkOk: 'есть · {ms} мс',
  linkNo: 'НЕТ',
  disk: 'Свободно на диске',
  mb: '{n} МБ',
  last: 'Последняя копия',
  none: 'нет ни одной',
  failed: 'Прошлый запуск не удался ({stage}): {error}',
  schedule:
    'Копии собираются каждую ночь в 03:30 и приходят в бота. Забрать прямо сейчас — команда /backup.',
} as const;
