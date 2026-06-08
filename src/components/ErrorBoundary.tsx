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
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', error, info);
    logError({ kind: 'react', message: error.message, stack: error.stack });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="screen">
          <div className="empty">
            <div className="empty__icon">⚠️</div>
            <div className="empty__title">Что-то пошло не так</div>
            <div className="empty__sub">{this.state.error.message}</div>
            <button
              className="btn btn--primary"
              style={{ marginTop: 20 }}
              onClick={() => this.setState({ error: null })}
            >
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
