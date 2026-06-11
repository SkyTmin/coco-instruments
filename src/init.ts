import {
  backButton,
  initData,
  init as initSDK,
  miniApp,
  setDebug,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';

/** Initialize the Telegram SDK and mount the components we rely on. */
export async function init(debug: boolean): Promise<void> {
  setDebug(debug);
  initSDK();

  // On-device console for mobile debugging (dev / ?startapp=debug only).
  if (debug) {
    void import('eruda').then(({ default: eruda }) => {
      eruda.init();
      eruda.position({ x: window.innerWidth - 50, y: 0 });
    });
  }

  backButton.mount.ifAvailable();
  initData.restore();

  if (miniApp.mount.isAvailable()) {
    themeParams.mount();
    miniApp.mount();
    themeParams.bindCssVars();
  }

  // Tell Telegram we're ready to be shown. Desktop is strict about this —
  // without the signal it can keep its loader and fail the launch.
  try {
    miniApp.ready();
  } catch {
    /* not critical outside Telegram */
  }

  if (viewport.mount.isAvailable()) {
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
  }
}
