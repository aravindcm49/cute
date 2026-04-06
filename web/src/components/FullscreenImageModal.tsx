import { useEffect } from "react";

type FullscreenImageModalProps = {
  src: string;
  alt?: string;
  isOpen: boolean;
  onClose: () => void;
};

export default function FullscreenImageModal({
  src,
  alt = "Fullscreen preview",
  isOpen,
  onClose,
}: FullscreenImageModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fullscreen-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="fullscreen-backdrop"
        onClick={onClose}
        aria-label="Close fullscreen preview backdrop"
        data-testid="fullscreen-backdrop"
      />
      <div className="fullscreen-content">
        <button
          type="button"
          className="fullscreen-close"
          onClick={onClose}
          aria-label="Close fullscreen preview"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6l-12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <img src={src} alt={alt} />
      </div>
    </div>
  );
}
