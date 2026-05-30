import { ErrorBoundary } from '@/components/ErrorBoundary';
import { App } from '@/App';

export function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
