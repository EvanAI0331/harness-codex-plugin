import type { HarnessEvent } from "shared/types";

type Listener = (event: HarnessEvent) => void;

const listeners = new Map<string, Set<Listener>>();

function getListeners(harnessId: string): Set<Listener> {
  let set = listeners.get(harnessId);
  if (!set) {
    set = new Set<Listener>();
    listeners.set(harnessId, set);
  }

  return set;
}

export function broadcastHarnessEvent(event: HarnessEvent): void {
  const set = listeners.get(event.harnessId);
  if (!set) {
    return;
  }

  for (const listener of set) {
    listener(event);
  }
}

export function subscribeHarnessEvents(harnessId: string, listener: Listener): () => void {
  const set = getListeners(harnessId);
  set.add(listener);

  return () => {
    const current = listeners.get(harnessId);
    if (!current) {
      return;
    }

    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(harnessId);
    }
  };
}
