/**
 * Cross-tab synchronization event bus using BroadcastChannel with localStorage fallback.
 * Allows instant live updates across tabs when records (such as students, teachers, schools) are added or deleted.
 */

export type SyncEventType = 'STUDENT_MUTATED' | 'SCHOOL_MUTATED' | 'TEACHER_MUTATED';

let channel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel('volpehub_data_sync_channel');
  }
} catch {
  channel = null;
}

export function broadcastSyncEvent(type: SyncEventType, payload?: Record<string, unknown>): void {
  const msg = { type, payload, timestamp: Date.now() };
  if (channel) {
    try {
      channel.postMessage(msg);
    } catch {
      // Ignore broadcast channel errors
    }
  }
  try {
    localStorage.setItem('volpehub_last_sync_event', JSON.stringify(msg));
  } catch {
    // Ignore storage quota or security errors
  }
}

export function subscribeSyncEvents(
  callback: (type: SyncEventType, payload?: Record<string, unknown>) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleChannelMessage = (ev: MessageEvent) => {
    if (ev.data && ev.data.type) {
      callback(ev.data.type, ev.data.payload);
    }
  };

  const handleStorageEvent = (ev: StorageEvent) => {
    if (ev.key === 'volpehub_last_sync_event' && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue);
        if (parsed && parsed.type) {
          callback(parsed.type, parsed.payload);
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  };

  if (channel) {
    channel.addEventListener('message', handleChannelMessage);
  }
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    if (channel) {
      channel.removeEventListener('message', handleChannelMessage);
    }
    window.removeEventListener('storage', handleStorageEvent);
  };
}

