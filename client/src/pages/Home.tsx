import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Activity, CheckCircle2, Download, Gamepad2, Play, RotateCcw, UploadCloud, XCircle } from "lucide-react";

type ConvertState = "idle" | "ready" | "converting" | "success" | "error";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ConvertState>("idle");
  const [message, setMessage] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputName, setOutputName] = useState("sticker.tgs");
  const [outputSize, setOutputSize] = useState<number | null>(null);

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    setOutputUrl("");
    setOutputSize(null);
    if (nextFile.type !== "image/gif" && !nextFile.name.toLowerCase().endsWith(".gif")) {
      setFile(null);
      setState("error");
      setMessage("Only GIF files can enter the pixelart2tgs engine.");
      return;
    }
    if (nextFile.size > MAX_INPUT_BYTES) {
      setFile(null);
      setState("error");
      setMessage("Input rejected: maximum GIF size is 8 MB.");
      return;
    }
    setFile(nextFile);
    setState("ready");
    setMessage("");
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const convert = async () => {
    if (!file || state === "converting") return;
    setState("converting");
    setMessage("Encoding vector frames... please hold.");
    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "image/gif",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Conversion failed." }));
        throw new Error(payload.error || "Conversion failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setOutputSize(blob.size);
      setOutputName(file.name.replace(/\.gif$/i, "") + ".tgs");
      setState("success");
      setMessage("TGS payload ready for Telegram.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unexpected converter error.");
    }
  };

  const reset = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setState("idle");
    setMessage("");
    setOutputUrl("");
    setOutputSize(null);
    setOutputName("sticker.tgs");
    if (inputRef.current) inputRef.current.value = "";
  };

  const isReady = Boolean(file) && (state === "ready" || state === "error");

  return (
    <div className="console-shell">
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-icon"><Gamepad2 size={18} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">TGS_CONSOLE</div>
            <div className="brand-edition">MEGA DRIVE / 199X EDITION</div>
          </div>
        </div>
        <div className="system-status"><span className="status-dot" /> SYSTEM ONLINE</div>
      </header>

      <main className="hero-grid">
        <section className="hero-copy">
          <div className="eyebrow"><span /> MEGA DRIVE UTILITY</div>
          <h1><span className="acid">GIF</span><span className="arrow">→</span><span className="coral">TGS</span></h1>
          <h2>MEGA DRIVE CONVERTER</h2>
          <p className="hero-description">Nahraj animaci, sleduj její převod a získej Telegram sticker s kontrolou limitů v reálném čase. Bez účtu. Bez cloudu. Bez magie.</p>
          <div className="limit-grid">
            <div className="limit-card"><span>01</span><strong>64 KB</strong><small>TGS MAX</small></div>
            <div className="limit-card"><span>02</span><strong>3 SEC</strong><small>LOOP MAX</small></div>
            <div className="limit-card"><span>03</span><strong>512 PX</strong><small>CANVAS</small></div>
          </div>
        </section>

        <section className="converter-wrap">
          <img className="mascot" src="/mascot.png" alt="" aria-hidden="true" />
          <div className="converter-card">
            <div className="section-kicker"><span>[ 01 / LOAD GIF ]</span><b>2</b></div>
            <h3>INSERT ANIMATION</h3>
            <label className={`drop-zone ${state === "error" ? "drop-error" : ""} ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
              <input ref={inputRef} className="file-input" aria-label="Choose GIF file" title="Choose GIF file" type="file" accept="image/gif,.gif" onChange={onInputChange} />
              <div className="upload-square"><UploadCloud size={24} /></div>
              {file ? (
                <>
                  <strong className="file-name">{file.name}</strong>
                  <span className="drop-caption">{formatBytes(file.size)} // READY TO LOAD</span>
                </>
              ) : (
                <>
                  <strong>DROP GIF HERE</strong>
                  <span className="drop-caption">GIF ONLY // MAX INPUT 8 MB</span>
                </>
              )}
              <span className="drop-hint">CLICK TO SELECT OR DRAG FILE</span>
            </label>
            <div className="action-row">
              <button className="convert-button" disabled={!isReady} onClick={convert}>
                <span className="button-index">3</span><Play size={13} fill="currentColor" /> {state === "converting" ? "CONVERTING..." : "START CONVERSION"}
              </button>
              <button className="reset-button" onClick={reset} aria-label="Reset converter"><RotateCcw size={13} /> RESET</button>
            </div>
            <div className={`progress-console state-${state}`} aria-live="polite">
              <Activity size={13} />
              <span>{message || "SEGA MODE // PIXELART2TGS ENGINE // TEMP FILES PURGED"}</span>
            </div>
            {state === "converting" && <div className="progress-bar"><span /></div>}
            {state === "success" && outputUrl && (
              <div className="result-panel">
                <div className="result-icon"><CheckCircle2 size={18} /></div>
                <div className="result-copy"><strong>{outputName}</strong><span>{outputSize ? `${Math.ceil(outputSize / 1024)} KB // TGS READY` : "TGS READY"}</span></div>
                <a className="download-button" href={outputUrl} download={outputName}><Download size={14} /> SAVE</a>
              </div>
            )}
            {state === "error" && message && <div className="error-panel"><XCircle size={16} /><span>{message}</span></div>}
          </div>
        </section>
      </main>

      <footer className="footer-bar"><span>SEGA MODE // PIXELART2TGS ENGINE // TEMP FILES PURGED</span><span>© TGS_CONSOLE 199X–2026</span></footer>
    </div>
  );
}

export { Gamepad2 };
