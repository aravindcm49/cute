import { useEffect, useRef, useState } from "react";

type LiveLogProps = {
  entries: string[];
};

export default function LiveLog({ entries }: LiveLogProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const prevEntriesLengthRef = useRef(entries.length);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const nearBottom = distanceFromBottom <= 50;
      setIsNearBottom(nearBottom);
      
      if (nearBottom) {
        setShowJumpToBottom(false);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (entries.length > prevEntriesLengthRef.current && !isNearBottom) {
      setShowJumpToBottom(true);
    }
    prevEntriesLengthRef.current = entries.length;

    if (isNearBottom) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [entries, isNearBottom]);

  const handleJumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    setShowJumpToBottom(false);
    setIsNearBottom(true);
  };

  return (
    <div className="log-panel">
      <h3>Live Log</h3>
      <div className="live-log" style={{ height: "400px" }}>
        <div ref={scrollContainerRef} className="live-log-scroll">
          {entries.length === 0 && (
            <p className="loading-indicator muted">
              <span className="spinner" />
              Waiting for updates...
            </p>
          )}
          {entries.filter((line) => line.trim() !== "").map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
        {showJumpToBottom && (
          <button
            type="button"
            className="jump-to-bottom"
            onClick={handleJumpToBottom}
          >
            Jump to bottom
          </button>
        )}
      </div>
    </div>
  );
}