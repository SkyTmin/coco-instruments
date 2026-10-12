/** General settings screen (`src/settings/`). */
export const settings = {
  title: 'Настройки',
  section: {
    language: 'Язык',
    sound: 'Звук',
    vibration: 'Вибрация',
    display: 'Экран',
    controls: 'Управление',
    progress: 'Прогресс',
  },
  language: {
    auto: 'Как в Telegram',
    autoHint: 'Сейчас: {name}',
  },
  sound: {
    sound: 'Звук',
    music: 'Музыка',
    master: 'Общая',
    musicVolume: 'Музыка',
    sfxVolume: 'Эффекты',
  },
  vibration: {
    on: 'Вибрация',
  },
  display: {
    scale: 'Масштаб',
    text: 'Текст',
    textS: 'Мелкий',
    textM: 'Обычный',
    textL: 'Крупный',
    motion: 'Меньше анимации',
    motionAuto: 'Как в системе',
  },
  controls: {
    soon: 'Здесь будут клавиши и геймпад',
  },
  progress: {
    wipePrison: 'Начать шахту заново',
    wipePrisonSure: 'Точно? Нажми ещё раз',
    wipePrisonNote: 'Монеты и уровень останутся — они общие с автоматами.',
    wipeAll: 'Сбросить все игры',
    wipeAllSure: 'Точно всё? Нажми ещё раз',
    wipeAllNote: 'Шахта, лес и автоматы с нуля, монет — снова тысяча. Отменить нельзя.',
    wipedAll: 'Всё в играх начато заново',
    wipedPrison: 'Каторга начата заново',
  },
} as const;
