'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api/client';

/** Read-only polling: no overlap, hidden-tab traffic or cached offline writes. */
export function useLiveResource<T>(
  url: string | null,
  initial: T | null = null,
  identity: string | null = url,
) {
  const [state, setState] = useState({
    key: identity,
    resolvedUrl: url,
    data: initial,
    error: false,
    fetching: false,
  });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const pause = () => {
      sequence++;
      clearTimeout(timer);
      controller?.abort();
    };
    async function load() {
      if (!url || document.hidden || !navigator.onLine) return;
      pause();
      const request = ++sequence;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 15_000);
      setState((current) => ({
        key: identity,
        resolvedUrl: current.resolvedUrl,
        data: current.key === identity ? current.data : null,
        error: current.key === identity && current.error,
        fetching: true,
      }));
      try {
        const data = await apiFetch<T>(url, {
          signal: requestController.signal,
          cache: 'no-store',
        });
        if (live && request === sequence)
          setState({ key: identity, resolvedUrl: url, data, error: false, fetching: false });
      } catch (error) {
        if (live && request === sequence)
          setState((current) => ({
            key: identity,
            resolvedUrl: current.resolvedUrl,
            data:
              error instanceof ApiError && [401, 403, 404].includes(error.status)
                ? null
                : current.data,
            error: true,
            fetching: false,
          }));
      } finally {
        clearTimeout(timeout);
        if (live && request === sequence && !document.hidden && navigator.onLine)
          timer = setTimeout(load, 5000);
      }
    }
    const wake = () => {
      if (document.hidden || !navigator.onLine) {
        pause();
        setState((current) => ({
          ...current,
          fetching: false,
          error: !navigator.onLine || current.error,
        }));
      } else void load();
    };
    setState((current) => ({
      key: identity,
      resolvedUrl: current.resolvedUrl,
      data: current.key === identity ? current.data : null,
      error: !navigator.onLine,
      fetching: false,
    }));
    void load();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    return () => {
      live = false;
      pause();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [url, identity, generation]);
  return {
    data: state.key === identity ? state.data : null,
    error: state.key === identity && state.error,
    fetching: state.key === identity && state.fetching,
    current: state.resolvedUrl === url,
    refresh,
  };
}
