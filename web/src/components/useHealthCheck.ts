import { useCallback, useEffect, useState } from "react";

export type HealthStatus = "checking" | "ready" | "no_model" | "no_connection";

export type HealthState = {
  status: HealthStatus;
  loadedModel: string | null;
  availableModels: string[];
};

export function useHealthCheck() {
  const [health, setHealth] = useState<HealthState>({
    status: "checking",
    loadedModel: null,
    availableModels: [],
  });

  const refetch = useCallback(async () => {
    setHealth((prev) => ({ ...prev, status: "checking" }));
    try {
      const res = await fetch("/api/health");
      if (!res.ok) {
        setHealth({ status: "no_connection", loadedModel: null, availableModels: [] });
        return;
      }
      const data = await res.json();
      setHealth({
        status: data.status ?? "no_connection",
        loadedModel: data.loadedModel ?? null,
        availableModels: data.availableModels ?? [],
      });
    } catch {
      setHealth({ status: "no_connection", loadedModel: null, availableModels: [] });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { health, refetch };
}
