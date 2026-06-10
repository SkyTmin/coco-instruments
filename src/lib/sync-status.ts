import { create } from 'zustand';

// Tiny status store fed by the storage layer (src/lib/storage.ts) and read by
// the SyncIndicator. Lives outside the main store so it never persists.

export type SyncState = 'idle' | 'saving' | 'error';

interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  setStatus: (state: SyncState, pendingCount: number) => void;
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  state: 'idle',
  pendingCount: 0,
  setStatus: (state, pendingCount) => set({ state, pendingCount }),
}));

export function reportSyncStatus(state: SyncState, pendingCount: number): void {
  useSyncStatus.getState().setStatus(state, pendingCount);
}
