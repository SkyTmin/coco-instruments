import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import { logError } from '@/lib/log';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error:', error, info);
    logError({ kind: 'react', message: error.message, stack: error.stack });
  }

  // Clear local caches (NOT the server data — that re-syncs on next load) and
  // reload. The escape hatch for a crash caused by a corrupt local cache.
  private resetAndReload = (): void => {
    try {
      localStorage.clear();
    } catch {
      /* private mode */
    }
    try {
      if ('caches' in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
      }
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="screen">
          <div className="empty">
            <div className="empty__icon">⚠️</div>
            <div className="empty__title">Что-то пошло не так</div>
            <div className="empty__sub">{this.state.error.message}</div>
            <div className="stack" style={{ marginTop: 20, width: '100%', maxWidth: 320 }}>
              <button
                className="btn btn--primary btn--block"
                onClick={() => window.location.reload()}
              >
                Перезагрузить
              </button>
              <button className="btn btn--ghost btn--block" onClick={this.resetAndReload}>
                Сбросить кеш и перезагрузить
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
