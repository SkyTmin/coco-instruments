import {
  backButton,
  initData,
  init as initSDK,
  miniApp,
  setDebug,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';

import { logError } from '@/lib/log';

/**
 * Ни один шаг инициализации не обязателен настолько, чтобы из-за него не
 * запустилось приложение. Раньше любое исключение здесь (скажем, при разборе
 * initData аккаунта с непривычным профилем) обрывало init() до ready() — и
 * человек навсегда оставался с заставкой Telegram поверх пустого экрана.
 * Теперь каждый шаг падает сам по себе и пишется в лог.
 */
function step(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    logError({
      kind: `init.${name}`,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
}

/** Initialize the Telegram SDK and mount the components we rely on. */
export async function init(debug: boolean): Promise<void> {
  step('setDebug', () => setDebug(debug));
  step('initSDK', () => initSDK());

  // Сказать Telegram, что показывать уже можно, — первым делом после старта
  // SDK. Дальше что угодно может не получиться, но заставка уже снята и
  // человек увидит либо приложение, либо понятную ошибку.
  step('ready', () => miniApp.ready());

  // On-device console for mobile debugging (dev / ?startapp=debug only).
  if (debug) {
    void import('eruda').then(({ default: eruda }) => {
      eruda.init();
      eruda.position({ x: window.innerWidth - 50, y: 0 });
    });
  }

  step('backButton', () => backButton.mount.ifAvailable());
  step('initData', () => initData.restore());

  step('miniApp', () => {
    if (!miniApp.mount.isAvailable()) return;
    themeParams.mount();
    miniApp.mount();
    themeParams.bindCssVars();
  });

  // Ещё раз, уже после монтирования: на части клиентов сигнал засчитывается
  // только от смонтированного miniApp.
  step('ready2', () => miniApp.ready());

  step('viewport', () => {
    if (!viewport.mount.isAvailable()) return;
    void viewport.mount().then(() => {
      viewport.bindCssVars();
      // Open the Mini App expanded to the full screen (Telegram v8.0+).
      try {
        if (viewport.requestFullscreen.isAvailable() && !viewport.isFullscreen()) {
          void viewport.requestFullscreen().catch(() => {});
        }
      } catch {
        /* fullscreen not supported on this client */
      }
    });
  });
}
