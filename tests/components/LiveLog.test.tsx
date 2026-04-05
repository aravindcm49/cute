import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LiveLog from "../../web/src/components/LiveLog";

afterEach(() => {
  cleanup();
});

describe("LiveLog", () => {
  it("renders log entries", () => {
    const entries = ["First log entry", "Second log entry"];
    render(<LiveLog entries={entries} />);

    expect(screen.getByText("First log entry")).toBeInTheDocument();
    expect(screen.getByText("Second log entry")).toBeInTheDocument();
  });

  it("shows waiting indicator when no entries", () => {
    render(<LiveLog entries={[]} />);

    expect(screen.getByText("Waiting for updates...")).toBeInTheDocument();
  });

  it("renders with fixed 400px height", () => {
    const { container } = render(<LiveLog entries={["Test entry"]} />);
    const logPanel = container.querySelector(".live-log") as HTMLElement;

    expect(logPanel).toBeTruthy();
    expect(logPanel.style.height).toBe("400px");
  });

  it("shows jump to bottom indicator when scrolled up and new content arrives", () => {
    const { rerender, container } = render(<LiveLog entries={["First entry"]} />);
    const logPanel = container.querySelector(".live-log-scroll") as HTMLElement;

    // Simulate being scrolled far from bottom (distance = 1000 - 0 - 400 = 600 > 50)
    Object.defineProperty(logPanel, "scrollTop", {
      get: () => 0,
      configurable: true,
    });
    Object.defineProperty(logPanel, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logPanel, "clientHeight", {
      get: () => 400,
      configurable: true,
    });

    // Fire scroll to update isNearBottom to false
    fireEvent.scroll(logPanel);

    // New entries arrive while scrolled up
    rerender(<LiveLog entries={["First entry", "Second entry"]} />);

    expect(screen.getByText("Jump to bottom")).toBeInTheDocument();
  });

  it("does not show jump to bottom when near bottom", () => {
    const { rerender, container } = render(<LiveLog entries={["First entry"]} />);
    const logPanel = container.querySelector(".live-log-scroll") as HTMLElement;

    // Simulate being at the bottom (distance = 1000 - 580 - 400 = 20, which is <= 50)
    Object.defineProperty(logPanel, "scrollTop", {
      get: () => 580,
      configurable: true,
    });
    Object.defineProperty(logPanel, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logPanel, "clientHeight", {
      get: () => 400,
      configurable: true,
    });

    // Fire scroll to confirm isNearBottom stays true
    fireEvent.scroll(logPanel);

    // New entries arrive
    rerender(<LiveLog entries={["First entry", "Second entry"]} />);

    expect(screen.queryByText("Jump to bottom")).not.toBeInTheDocument();
  });

  it("jump to bottom button calls scrollTo when clicked", () => {
    const { rerender, container } = render(<LiveLog entries={["First entry"]} />);
    const logPanel = container.querySelector(".live-log-scroll") as HTMLElement;

    const scrollToSpy = vi.fn();
    logPanel.scrollTo = scrollToSpy;

    // Simulate being scrolled up
    Object.defineProperty(logPanel, "scrollTop", {
      get: () => 0,
      configurable: true,
    });
    Object.defineProperty(logPanel, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logPanel, "clientHeight", {
      get: () => 400,
      configurable: true,
    });

    fireEvent.scroll(logPanel);

    rerender(<LiveLog entries={["First entry", "Second entry"]} />);

    const jumpButton = screen.getByText("Jump to bottom");
    fireEvent.click(jumpButton);

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 1000,
      behavior: "smooth",
    });
  });

  it("auto-scrolls when near bottom and new entries arrive", () => {
    const { rerender, container } = render(<LiveLog entries={["First entry"]} />);
    const logPanel = container.querySelector(".live-log-scroll") as HTMLElement;

    const scrollToSpy = vi.fn();
    logPanel.scrollTo = scrollToSpy;

    // Near bottom (distance = 1000 - 580 - 400 = 20)
    Object.defineProperty(logPanel, "scrollTop", {
      get: () => 580,
      configurable: true,
    });
    Object.defineProperty(logPanel, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logPanel, "clientHeight", {
      get: () => 400,
      configurable: true,
    });

    fireEvent.scroll(logPanel);

    rerender(<LiveLog entries={["First entry", "Second entry"]} />);

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" })
    );
  });
});