"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

/** Loads a GET endpoint with loading / error / reload state. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>("GET", path));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "generic"));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
