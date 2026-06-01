import {
  backButton,
  initData,
  init as initSDK,
  miniApp,
  setDebug,
  swipeBehavior,
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

  // Stop Telegram from minimizing / dropping out of fullscreen when our own
  // horizontal swipes (calendar paging, swipe-to-delete) carry a slight
  // vertical component. This disables only Telegram's native swipe-down
  // gesture — our in-app swipes and normal vertical scrolling keep working.
  try {
    if (swipeBehavior.mount.isAvailable()) {
      swipeBehavior.mount();
      if (swipeBehavior.disableVertical.isAvailable()) swipeBehavior.disableVertical();
    }
  } catch {
    /* swipe behavior not supported on this client */
  }

  if (miniApp.mount.isAvailable()) {
    themeParams.mount();
    miniApp.mount();
    themeParams.bindCssVars();
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
