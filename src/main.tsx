// Telegram UI styles first so our theme.css can override where needed.
import '@telegram-apps/telegram-ui/dist/styles.css';
import './theme.css';

// Mock the Telegram env in dev (no-op / tree-shaken in production).
import './mockEnv';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { retrieveLaunchParams } from '@tma.js/sdk-react';

import { Root } from '@/Root';
import { init } from '@/init';

const root = ReactDOM.createRoot(document.getElementById('root')!);

try {
  const lp = retrieveLaunchParams();
  const debug = import.meta.env.DEV || `${lp.tgWebAppStartParam || ''}`.includes('debug');
  await init(debug);
  root.render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
} catch (e) {
  root.render(
    <div className="screen">
      <div className="empty">
        <div className="empty__icon">📵</div>
        <div className="empty__title">Откройте приложение в Telegram</div>
        <div className="empty__sub">{e instanceof Error ? e.message : String(e)}</div>
      </div>
    </div>,
  );
}
