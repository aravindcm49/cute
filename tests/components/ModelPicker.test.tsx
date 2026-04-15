import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ModelPicker } from "../../web/src/components/ModelPicker";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ModelPicker", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows loading state initially", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ModelPicker />);
    expect(screen.getByText("Loading models...")).toBeInTheDocument();
  });

  it("renders model options after loading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
            { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
          ],
          current: { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
        }),
    });

    render(<ModelPicker />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("anthropic:claude-3-sonnet");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Claude 3 Sonnet (anthropic)");
    expect(options[1]).toHaveTextContent("GPT-4o (openai)");
  });

  it("shows no models available when list is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [],
          current: null,
        }),
    });

    render(<ModelPicker />);

    await waitFor(() => {
      expect(screen.getByText("No models available.")).toBeInTheDocument();
    });
  });

  it("shows error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Provider unavailable" }),
    });

    render(<ModelPicker />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load models.")).toBeInTheDocument();
    });
  });

  it("calls onModelChange callback after switching model", async () => {
    const onModelChange = vi.fn();

    // Initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
            { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
          ],
          current: { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
        }),
    });

    // Switch model response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          current: { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
        }),
    });

    render(<ModelPicker onModelChange={onModelChange} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "openai:gpt-4o" } });

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith({
        provider: "openai",
        id: "gpt-4o",
        name: "GPT-4o",
      });
    });
  });

  it("shows error when model switch fails", async () => {
    // Initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
            { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
          ],
          current: { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
        }),
    });

    // Switch model fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Model not found" }),
    });

    render(<ModelPicker />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "openai:gpt-4o" } });

    await waitFor(() => {
      expect(screen.getByText("Model not found")).toBeInTheDocument();
    });
  });
});