import { type SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import { type DependencyList, useEffect, useEffectEvent, useState } from 'react';

import { subscribeDataChanged } from './events';

type QueryState<T> = { data: T | undefined; error: Error | null; loading: boolean; ranWith: readonly unknown[] | null };

function sameDeps(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  return a !== null && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

const SLOW_QUERY_MS = 50;

/**
 * Runs an async database query and re-runs it when `deps` change or when any
 * write calls notifyDataChanged().
 *
 *   const { data } = useQuery((db) => listAccounts(db), []);
 *
 * While a re-run is in progress the previous `data` stays available (no flicker) and `stale` is true, so
 * a screen can avoid acting on results that no longer match what the user asked for.
 */
export function useQuery<T>(query: (db: SQLiteDatabase) => Promise<T>, deps: DependencyList) {
  const db = useSQLiteContext();
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: null, loading: true, ranWith: null });
  const [version, setVersion] = useState(0);
  const current = [...deps, version];
  const runQuery = useEffectEvent(() => query(db));

  useEffect(() => subscribeDataChanged(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let active = true;
    const started = Date.now();
    const ranWith = current;
    runQuery().then(
      (data) => {
        if (__DEV__) {
          const ms = Date.now() - started;
          // Development aid: flags queries that would make a screen feel slow.
          if (ms > SLOW_QUERY_MS) console.warn(`[slow query] ${ms} ms`);
        }
        if (active) setState({ data, error: null, loading: false, ranWith });
      },
      (error: Error) => {
        if (!active) return;
        console.error(error);
        setState((s) => ({ ...s, error, loading: false, ranWith }));
      },
    );
    return () => {
      active = false;
    };
    // `deps` is the caller's dependency list, like useEffect itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, current);

  return { data: state.data, error: state.error, loading: state.loading, stale: !sameDeps(state.ranWith, current) };
}
