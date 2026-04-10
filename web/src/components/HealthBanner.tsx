import type { HealthState } from "./useHealthCheck";

type HealthBannerProps = {
  health: HealthState;
  onCheckAgain: () => void;
};

export default function HealthBanner({ health, onCheckAgain }: HealthBannerProps) {
  if (health.status === "checking") {
    return (
      <div className="health-banner health-checking" role="status">
        <span className="spinner" />
        Checking LMStudio connection…
      </div>
    );
  }

  if (health.status === "ready") {
    return (
      <div className="health-banner health-ready" role="status">
        ✓ LMStudio ready — <strong>{health.loadedModel}</strong> loaded
        <button type="button" className="health-check-btn" onClick={onCheckAgain}>
          Check Again
        </button>
      </div>
    );
  }

  if (health.status === "no_model") {
    return (
      <div className="health-banner health-no-model" role="alert">
        ⚠ Model not found in LMStudio.
        {health.availableModels.length > 0 && (
          <span className="health-models">
            {" "}Available: {health.availableModels.join(", ")}
          </span>
        )}
        <button type="button" className="health-check-btn" onClick={onCheckAgain}>
          Check Again
        </button>
      </div>
    );
  }

  return (
    <div className="health-banner health-no-connection" role="alert">
      ✕ Cannot connect to LMStudio. Is it running?
      <button type="button" className="health-check-btn" onClick={onCheckAgain}>
        Check Again
      </button>
    </div>
  );
}
