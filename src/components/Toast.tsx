import { useEffect, useState } from 'react';

// Lightweight toast: a module-level emitter so non-React code (the storage
// layer) can show messages, and a single host rendered once in App.

export type ToastKind = 'info' | 'error';

interface ToastMessage {
  id: number;
  text: string;
  kind: ToastKind;
}

type Listener = (toast: ToastMessage) => void;

let listener: Listener | null = null;
let nextId = 1;
let queued: ToastMessage | null = null;

export function showToast(text: string, kind: ToastKind = 'info'): void {
  const toast = { id: nextId++, text, kind };
  if (listener) listener(toast);
  else queued = toast; // host not mounted yet — show on mount
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    listener = setToast;
    if (queued) {
      setToast(queued);
      queued = null;
    }
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      className={`toast ${toast.kind === 'error' ? 'toast--error' : ''}`}
      role="status"
      aria-live="polite"
      onClick={() => setToast(null)}
    >
      {toast.text}
    </div>
  );
}
