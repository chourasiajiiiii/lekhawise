/**
 * Minimal change notification. Every write calls notifyDataChanged(); every
 * useQuery() re-runs. With a local database this is cheap and keeps all
 * screens in sync without a state library.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDataChanged(): void {
  listeners.forEach((listener) => listener());
}
