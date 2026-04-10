import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

type ImageHoverZoomProps = {
  src: string;
  alt: string;
  zoom?: number;
  magnifierSize?: number;
  onExpand?: () => void;
  enableFullscreenShortcut?: boolean;
};

type MagnifierPositionParams = {
  cursorX: number;
  cursorY: number;
  imageWidth: number;
  imageHeight: number;
  magnifierSize: number;
  offset: number;
};

type BackgroundPositionParams = {
  cursorX: number;
  cursorY: number;
  magnifierSize: number;
  zoom: number;
};

const DEFAULT_ZOOM = 2.5;
const DEFAULT_MAGNIFIER_SIZE = 150;
const DEFAULT_OFFSET = 16;

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function getMagnifierPosition({
  cursorX,
  cursorY,
  imageWidth,
  imageHeight,
  magnifierSize,
  offset,
}: MagnifierPositionParams) {
  const maxLeft = Math.max(imageWidth - magnifierSize, 0);
  const maxTop = Math.max(imageHeight - magnifierSize, 0);
  const shouldFlip = cursorX + magnifierSize + offset > imageWidth;
  const rawLeft = shouldFlip ? cursorX - magnifierSize - offset : cursorX + offset;
  const left = clamp(rawLeft, 0, maxLeft);
  const top = clamp(cursorY - magnifierSize / 2, 0, maxTop);

  return { left, top, flipped: shouldFlip };
}

export function getBackgroundPosition({
  cursorX,
  cursorY,
  magnifierSize,
  zoom,
}: BackgroundPositionParams) {
  return {
    x: -cursorX * zoom + magnifierSize / 2,
    y: -cursorY * zoom + magnifierSize / 2,
  };
}

export default function ImageHoverZoom({
  src,
  alt,
  zoom = DEFAULT_ZOOM,
  magnifierSize = DEFAULT_MAGNIFIER_SIZE,
  onExpand,
  enableFullscreenShortcut = false,
}: ImageHoverZoomProps) {
  const [isActive, setIsActive] = useState(false);
  const [cursor, setCursor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!onExpand || !enableFullscreenShortcut) {
      return;
    }

    const handleExpand = onExpand;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "f" || event.key === "F") {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable ||
            active.hasAttribute("contenteditable"))
        ) {
          return;
        }
        event.preventDefault();
        handleExpand();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onExpand, enableFullscreenShortcut]);

  const handleMouseMove = (event: MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height);

    setCursor({ x, y, width: rect.width, height: rect.height });
    setIsActive(true);
  };

  const handleMouseLeave = () => {
    setIsActive(false);
  };

  const showMagnifier = isActive && cursor !== null;
  const magnifierStyles: CSSProperties = {};

  if (showMagnifier && cursor) {
    const { left, top } = getMagnifierPosition({
      cursorX: cursor.x,
      cursorY: cursor.y,
      imageWidth: cursor.width,
      imageHeight: cursor.height,
      magnifierSize,
      offset: DEFAULT_OFFSET,
    });
    const backgroundPosition = getBackgroundPosition({
      cursorX: cursor.x,
      cursorY: cursor.y,
      magnifierSize,
      zoom,
    });

    magnifierStyles.left = `${left}px`;
    magnifierStyles.top = `${top}px`;
    magnifierStyles.width = `${magnifierSize}px`;
    magnifierStyles.height = `${magnifierSize}px`;
    magnifierStyles.backgroundImage = `url(${src})`;
    magnifierStyles.backgroundRepeat = "no-repeat";
    magnifierStyles.backgroundSize = `${cursor.width * zoom}px ${cursor.height * zoom}px`;
    magnifierStyles.backgroundPosition = `${backgroundPosition.x}px ${backgroundPosition.y}px`;
  }

  return (
    <div className="image-hover-zoom">
      <img
        src={src}
        alt={alt}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {onExpand && (
        <button
          type="button"
          className="image-expand-button"
          onClick={onExpand}
          aria-label="Open fullscreen preview"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 3H3v6M3 3l7 7M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7M15 21h6v-6M21 21l-7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {showMagnifier && <div className="image-hover-magnifier" style={magnifierStyles} />}
    </div>
  );
}
