import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import HealthBanner from "../../web/src/components/HealthBanner";
import type { HealthState } from "../../web/src/components/useHealthCheck";

describe("HealthBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows checking state with spinner", () => {
    const health: HealthState = { status: "checking", loadedModel: null, availableModels: [] };
    render(<HealthBanner health={health} onCheckAgain={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking LMStudio connection");
  });

  it("shows ready state with model name", () => {
    const health: HealthState = { status: "ready", loadedModel: "gemma-4", availableModels: [] };
    render(<HealthBanner health={health} onCheckAgain={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("LMStudio ready");
    expect(screen.getByRole("status")).toHaveTextContent("gemma-4");
  });

  it("shows no_model state with available models", () => {
    const health: HealthState = {
      status: "no_model",
      loadedModel: null,
      availableModels: ["model-a", "model-b"],
    };
    render(<HealthBanner health={health} onCheckAgain={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Model not found");
    expect(screen.getByRole("alert")).toHaveTextContent("model-a");
    expect(screen.getByRole("alert")).toHaveTextContent("model-b");
  });

  it("shows no_connection state", () => {
    const health: HealthState = { status: "no_connection", loadedModel: null, availableModels: [] };
    render(<HealthBanner health={health} onCheckAgain={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot connect to LMStudio");
  });

  it("calls onCheckAgain when button is clicked", () => {
    const onCheckAgain = vi.fn();
    const health: HealthState = { status: "ready", loadedModel: "test", availableModels: [] };
    render(<HealthBanner health={health} onCheckAgain={onCheckAgain} />);
    fireEvent.click(screen.getByText("Check Again"));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  it("disables run button guidance — no_connection has no Check Again for run", () => {
    const health: HealthState = { status: "no_connection", loadedModel: null, availableModels: [] };
    render(<HealthBanner health={health} onCheckAgain={vi.fn()} />);
    expect(screen.getByText("Check Again")).toBeTruthy();
  });
});
