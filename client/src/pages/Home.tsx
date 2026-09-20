import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import lottie from "lottie-web";
import { Activity, CheckCircle2, Cpu, Download, Gamepad2, Play, RotateCcw, UploadCloud, X, XCircle } from "lucide-react";

type ConvertState = "idle" | "ready" | "converting" | "success" | "error";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

type TgsMeta = { size: number; frames: number; fps: number; duration: number; width: number; height: number };

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function lottieProperty(value: any, fallback: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { a: 0, k: value ?? fallback };
  if (!("k" in value)) return { a: 0, k: value };
  if ("a" in value) return value;
  const animated = Array.isArray(value.k) && value.k.some((item: any) => item && typeof item === "object" && "t" in item);
  return { ...value, a: animated ? 1 : 0 };
}

function padStaticVector(value: any, length: number) {
  return value.a === 0 && Array.isArray(value.k) && value.k.every((item: any) => typeof item === "number")
    ? { ...value, k: [...value.k, ...Array(Math.max(0, length - value.k.length)).fill(0)] } : value;
}

function repairLottieTransform(value: any, isLayer = false) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...source, a: lottieProperty(source.a, isLayer ? [0, 0, 0] : [0, 0]), p: padStaticVector(lottieProperty(source.p, isLayer ? [0, 0, 0] : [0, 0]), isLayer ? 3 : 2), s: padStaticVector(lottieProperty(source.s, isLayer ? [100, 100, 100] : [100, 100]), isLayer ? 3 : 2), r: lottieProperty(source.r, 0), o: lottieProperty(source.o, 100) };
}

function repairLottieData(value: any): any {
  if (Array.isArray(value)) return value.map(repairLottieData);
  if (!value || typeof value !== "object") return value;
  const result = { ...value };
  if (result.ty === "tr") Object.assign(result, repairLottieTransform(result));
  if (result.ty === "sh" && result.ks && typeof result.ks === "object") {
    result.ks = { ...result.ks, a: result.ks.a ?? 0 };
    if (result.ks.k && typeof result.ks.k === "object" && !Array.isArray(result.ks.k)) {
      result.ks.k = { ...result.ks.k, i: Array.isArray(result.ks.k.i) ? result.ks.k.i.map((item: any) => Array.isArray(item) && item.length ? item : [0, 0]) : result.ks.k.i, o: Array.isArray(result.ks.k.o) ? result.ks.k.o.map((item: any) => Array.isArray(item) && item.length ? item : [0, 0]) : result.ks.k.o };
    }
    return result;
  }
  if (result.ty === "st") { result.c = lottieProperty(result.c, [0, 0, 0]); result.o = lottieProperty(result.o, 100); result.w = lottieProperty(result.w, 0); }
  if (result.ty === "fl") { result.c = lottieProperty(result.c, [1, 1, 1]); result.o = lottieProperty(result.o, 100); }
  if (Array.isArray(result.layers)) {
    result.layers = result.layers.map((layer: any, index: number) => ({ ...layer, ind: layer.ind ?? index + 1, st: layer.st ?? 0, ddd: layer.ddd ?? 0, ks: repairLottieTransform(layer.ks, true), shapes: repairLottieData(layer.shapes) }));
    if (result.ddd == null) result.ddd = 0;
    if (result.assets == null) result.assets = [];
  }
  for (const [key, child] of Object.entries(result)) if (key !== "layers") result[key] = repairLottieData(child);
  return result;
}

function TgsPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let animation: ReturnType<typeof lottie.loadAnimation> | null = null;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url);
        const compressed = await response.arrayBuffer();
        const stream = new DecompressionStream("gzip");
        const json = repairLottieData(JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(stream)).text()));
        if (cancelled || !containerRef.current) return;
        containerRef.current.replaceChildren();
        animation = lottie.loadAnimation({ container: containerRef.current, renderer: "canvas", loop: true, autoplay: true, animationData: json, rendererSettings: { clearCanvas: true, progressiveLoad: false } } as any);
        (animation as any).setSubframe?.(false);
        (animation as any).goToAndStop?.(0, true);
        requestAnimationFrame(() => (animation as any)?.play?.());
      } catch {
        if (containerRef.current) containerRef.current.textContent = "TGS PREVIEW UNAVAILABLE";
      }
    })();
    return () => { cancelled = true; animation?.destroy(); };
  }, [url]);
  return <div ref={containerRef} className="tgs-player" aria-label="TGS animation preview" />;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [state, setState] = useState<ConvertState>("idle");
  const [message, setMessage] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputName, setOutputName] = useState("sticker.tgs");
  const [meta, setMeta] = useState<TgsMeta | null>(null);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); if (outputUrl) URL.revokeObjectURL(outputUrl); }, [fileUrl, outputUrl]);

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(""); setMeta(null);
    if (nextFile.type !== "image/gif" && !nextFile.name.toLowerCase().endsWith(".gif")) { setFile(null); setState("error"); setMessage("FILE TYPE ERROR // Vyber soubor s příponou .gif."); return; }
    if (nextFile.size > MAX_INPUT_BYTES) { setFile(null); setState("error"); setMessage("SIZE ERROR // GIF může mít maximálně 8 MB."); return; }
    setFile(nextFile); setFileUrl(URL.createObjectURL(nextFile)); setState("ready"); setMessage("");
  };
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); };

  const convert = async () => {
    if (!file || state === "converting") return;
    setState("converting"); setMessage("PROCESSING...");
    try {
      const response = await fetch("/api", { method: "POST", headers: { "Content-Type": "image/gif", "X-File-Name": encodeURIComponent(file.name) }, body: file });
      if (!response.ok) { const payload = await response.json().catch(() => ({ error: "CONVERSION ERROR // Převod se nepodařil." })); throw new Error(payload.error); }
      const blob = await response.blob();
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      const url = URL.createObjectURL(blob);
      const fps = Number(response.headers.get("X-TGS-FPS") || 60);
      const frames = Number(response.headers.get("X-TGS-Frames") || 0);
      setOutputUrl(url); setOutputName(file.name.replace(/\.gif$/i, "") + ".tgs");
      setMeta({ size: blob.size, fps, frames, duration: Number(response.headers.get("X-TGS-Duration") || (frames / fps).toFixed(2)), width: Number(response.headers.get("X-TGS-Width") || 512), height: Number(response.headers.get("X-TGS-Height") || 512) });
      setState("success"); setMessage("TGS DATA // GZIP LOTTIE PLAYER");
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "CONVERSION ERROR // Převod se nepodařil."); }
  };

  const reset = () => { if (fileUrl) URL.revokeObjectURL(fileUrl); if (outputUrl) URL.revokeObjectURL(outputUrl); setFile(null); setFileUrl(""); setState("idle"); setMessage(""); setOutputUrl(""); setOutputName("sticker.tgs"); setMeta(null); if (inputRef.current) inputRef.current.value = ""; };
  const isReady = Boolean(file) && (state === "ready" || state === "error");
  const readyChecks = meta && meta.size <= 64 * 1024 && meta.duration <= 3 && meta.width === 512 && meta.height === 512;

  return (
    <main className="retro-scanlines">
      <div className="app-frame">
        <header className="topbar"><div className="brand-lockup"><div className="brand-icon"><Gamepad2 size={20} /></div><div><div className="brand-name">TGS<span className="brand-accent">_</span>CONSOLE</div><div className="brand-edition">SEGA MODE / 199X EDITION</div></div></div><div className="system-status"><span className="status-dot" /> system online</div></header>
        <section className="hero-grid">
          <div className="hero-copy"><div className="eyebrow"><span /> mega drive utility</div><h1 className="hero-title"><span className="acid">GIF</span> <span className="arrow">→ TGS</span><br /><span className="hero-subtitle">MEGA DRIVE CONVERTER</span></h1><p className="hero-description">Nahraj animaci, sleduj její převod a získej Telegram sticker s kontrolou limitů v reálném čase. Bez účtu. Bez cloudu. Bez magie.</p><div className="limit-grid"><div className="limit-card"><span>01</span>64 KB<br />TGS MAX</div><div className="limit-card"><span>02</span>3 SEC<br />LOOP MAX</div><div className="limit-card"><span>03</span>512 PX<br />CANVAS</div></div></div>
          <div className="converter-wrap"><img className="mascot" src="/mascot.png" alt="Retro blue speed hero holding a Mega Drive gamepad" /><div className="converter-card"><div className="converter-inner"><div className="card-heading"><div><p>[ 01 / LOAD GIF ]</p><h2>INSERT ANIMATION</h2></div><Cpu className="cpu-icon" size={20} /></div><button type="button" className={`drop-zone ${state === "error" ? "drop-error" : ""} ${file ? "has-file" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={onDrop}>{file ? <div className="gif-preview"><img src={fileUrl} alt="Náhled GIFu" /><div className="file-line"><div><strong>{file.name}</strong><span>{formatBytes(file.size)} // INPUT GIF // MAX 8 MB</span></div><span className="remove-file" onClick={event => { event.stopPropagation(); reset(); }} aria-label="Odebrat GIF"><X size={15} /></span></div></div> : <><span className="upload-square"><UploadCloud size={24} /></span><span className="drop-title">DROP GIF HERE</span><span className="drop-caption">GIF ONLY // MAX INPUT 8 MB</span></>}</button><input ref={inputRef} className="hidden-input" aria-label="Choose GIF file" type="file" accept="image/gif,.gif" onChange={onInputChange} /><div className="action-row"><button className="convert-button" disabled={!isReady} onClick={convert}><Play size={16} fill="currentColor" /> {state === "converting" ? "PROCESSING..." : "START CONVERSION"}</button><button className="reset-button" onClick={reset} aria-label="Reset converter"><RotateCcw size={14} /> reset</button></div>{state !== "idle" && <div className={`progress-console state-${state}`} aria-live="polite"><Activity size={13} /><span>{message || "SEGA MODE // PIXELART2TGS ENGINE // TEMP FILES PURGED"}</span></div>}{state === "converting" && <div className="progress-bar"><span /></div>}{state === "error" && message && <div className="error-panel"><XCircle size={16} /><span>{message}</span></div>}</div></div>
          {state === "success" && outputUrl && meta && <div className="results-grid"><section className="output-card"><div className="result-kicker">[ 02 / TGS OUTPUT ]</div><h3>PREVIEW PLAYER</h3><div className="tgs-preview-frame"><TgsPreview url={outputUrl} /><span>TGS DATA // GZIP LOTTIE PLAYER</span></div><div className="output-footer"><div><strong>{outputName}</strong><small>{formatBytes(meta.size)} // GZIP TGS</small></div><a className="download-button" href={outputUrl} download={outputName}><Download size={14} /> SAVE</a></div></section><aside className="diagnostics-card"><div className="result-kicker">[ 03 / DIAGNOSTICS ]</div><h3>TELEGRAM LIMIT CHECK</h3><div className={`telegram-status ${readyChecks ? "ready" : "warn"}`}>STATUS: {readyChecks ? "TELEGRAM READY" : "OPTIMIZATION ADVISED"}</div><div className="checks"><CheckRow ok={meta.size <= 64 * 1024} label="Komprimovaná velikost" value={formatBytes(meta.size)} hint="LIMIT ≤ 64 KB" /><CheckRow ok={meta.duration <= 3} label="Délka animace" value={`${meta.duration.toFixed(2)} s`} hint="LIMIT ≤ 3 s" /><CheckRow ok={meta.width === 512 && meta.height === 512} label="Plátno" value={`${meta.width} × ${meta.height}`} hint="LIMIT 512 × 512 px" /></div><div className="stat-row"><span><b>{meta.frames}</b>frames</span><span><b>{meta.fps}</b>fps</span><span><b>{meta.duration.toFixed(2)}s</b>duration</span></div></aside></div>}
          </div>
        </section>
        <footer className="footer-bar"><span>SEGA MODE // PIXELART2TGS ENGINE // TEMP FILES PURGED</span><span>© TGS_CONSOLE 199X–2026</span></footer>
      </div>
    </main>
  );
}

function CheckRow({ ok, label, value, hint }: { ok: boolean; label: string; value: string; hint: string }) { return <div className="check-row"><CheckCircle2 size={16} className={ok ? "check-ok" : "check-warn"} /><div><strong>{label}</strong><small>{hint}</small></div><b>{value}</b></div>; }

export { Gamepad2 };
