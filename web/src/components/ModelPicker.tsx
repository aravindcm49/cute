import { useEffect, useState, useCallback } from "react";

export type ModelInfo = {
  provider: string;
  id: string;
  name: string;
};

type ModelsResponse = {
  models: ModelInfo[];
  current: ModelInfo | null;
};

export function ModelPicker({
  onModelChange,
}: {
  onModelChange?: (model: ModelInfo | null) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        throw new Error("Failed to fetch models.");
      }
      const data: ModelsResponse = await res.json();
      setModels(data.models);
      setCurrentModel(data.current);
      onModelChange?.(data.current);
      setError(null);
    } catch {
      setError("Failed to load models.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleSwitch = async (provider: string, modelId: string) => {
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to switch model.");
      }
      const data: { current: ModelInfo } = await res.json();
      setCurrentModel(data.current);
      onModelChange?.(data.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch model.");
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return (
      <div className="model-picker">
        <span className="model-picker-label">Model:</span>
        <span className="muted">Loading models...</span>
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="model-picker">
        <span className="model-picker-label">Model:</span>
        <span className="error">{error}</span>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="model-picker">
        <span className="model-picker-label">Model:</span>
        <span className="muted">No models available.</span>
      </div>
    );
  }

  return (
    <div className="model-picker">
      <label className="model-picker-label" htmlFor="model-select">
        Model:
      </label>
      <select
        id="model-select"
        value={currentModel ? `${currentModel.provider}:${currentModel.id}` : ""}
        onChange={(e) => {
          const val = e.target.value;
          const [provider, ...rest] = val.split(":");
          const modelId = rest.join(":");
          void handleSwitch(provider, modelId);
        }}
        disabled={switching}
      >
        {models.map((m) => (
          <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
            {m.name} ({m.provider})
          </option>
        ))}
      </select>
      {switching && <span className="muted">Switching...</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
