import { useMemo, useState } from "react";

type Screen = "folder" | "processing";

type ImageEntry = {
  name: string;
  path: string;
};

type LoadState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [screen, setScreen] = useState<Screen>("folder");
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canRun = images.length > 0 && loadState === "success";

  const displayList = useMemo(() => {
    return images.map((image) => image.name);
  }, [images]);

  async function handleScan() {
    if (!folderPath.trim()) {
      setErrorMessage("Enter a folder path to scan.");
      setLoadState("error");
      setImages([]);
      return;
    }

    setLoadState("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/images?folder=${encodeURIComponent(folderPath)}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load images.");
      }

      setImages(payload.images ?? []);
      setLoadState("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load images.";
      setImages([]);
      setLoadState("error");
      setErrorMessage(message);
    }
  }

  function handleRun() {
    setScreen("processing");
  }

  function handleReset() {
    setScreen("folder");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-eyebrow">Transcription Review</p>
        <h1>Sandcastle Transcription UI</h1>
        <p className="app-subtitle">
          Point the app at a folder of slides, verify the images found, then run transcription.
        </p>
      </header>

      {screen === "folder" ? (
        <section className="panel">
          <label className="field">
            <span>Folder Path</span>
            <input
              type="text"
              placeholder="/Users/you/Pictures/Slides"
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
            />
          </label>

          <div className="button-row">
            <button type="button" className="secondary" onClick={handleScan}>
              Scan Folder
            </button>
            <button type="button" className="primary" onClick={handleRun} disabled={!canRun}>
              Run
            </button>
          </div>

          <div className="status">
            {loadState === "loading" && <p>Scanning folder...</p>}
            {loadState === "error" && errorMessage && <p className="error">{errorMessage}</p>}
            {loadState === "success" && (
              <p>
                Found <strong>{images.length}</strong> image{images.length === 1 ? "" : "s"}.
              </p>
            )}
          </div>

          <ul className="image-list">
            {displayList.map((name) => (
              <li key={name}>{name}</li>
            ))}
            {loadState === "success" && images.length === 0 && (
              <li className="muted">No images found in this folder.</li>
            )}
          </ul>
        </section>
      ) : (
        <section className="panel">
          <h2>Processing</h2>
          <p className="muted">Processing screen stub. Next slice will add live progress.</p>
          <button type="button" className="secondary" onClick={handleReset}>
            Back to Folder
          </button>
        </section>
      )}
    </div>
  );
}
