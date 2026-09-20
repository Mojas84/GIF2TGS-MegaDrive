// Supabase Edge Function: GIF -> Telegram TGS.
// Public endpoint by design: the web app is a public, unauthenticated converter.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore npm packages are resolved by the Supabase Edge runtime.
import { parseGIF, decompressFrames } from "npm:gifuct-js@2.1.2";
// @ts-ignore npm packages are resolved by the Supabase Edge runtime.
import pako from "npm:pako@2.1.0";

type Point = [number, number];
type Form = { pos: Point; color: [number, number, number, number] };
type Frame = Form[];
type ShapeRecord = { shape: Point[]; frames: Frame[] };

const MAX_INPUT = 8 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-file-name, authorization",
  "Access-Control-Expose-Headers": "Content-Disposition, X-TGS-Size, X-TGS-FPS, X-TGS-Frames, X-TGS-Duration, X-TGS-Width, X-TGS-Height",
};

function key(p: Point): string { return `${p[0]},${p[1]}`; }
function parseKey(value: string): Point { return value.split(",").map(Number) as Point; }
function shapeKey(shape: Point[]): string { return shape.map(key).sort().join(";"); }
function colorKey(c: [number, number, number, number]): string { return c.join(","); }
function cloneCanvas(canvas: Uint8ClampedArray): Uint8ClampedArray { return new Uint8ClampedArray(canvas); }

function composeGif(buffer: ArrayBuffer) {
  const gif = parseGIF(buffer);
  const decoded = decompressFrames(gif, true) as Array<any>;
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const frames: Uint8ClampedArray[] = [];
  const durations: number[] = [];
  let canvas = new Uint8ClampedArray(width * height * 4);
  let restore: Uint8ClampedArray | null = null;

  for (const frame of decoded) {
    if (frame.disposalType === 3) restore = cloneCanvas(canvas);
    const { left, top, width: fw, height: fh } = frame.dims;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const source = (y * fw + x) * 4;
        const target = ((top + y) * width + left + x) * 4;
        const alpha = frame.patch[source + 3];
        if (alpha > 0) canvas.set(frame.patch.slice(source, source + 4), target);
      }
    }
    frames.push(cloneCanvas(canvas));
    durations.push(Math.max(1, Math.round((Number(frame.delay) || 50) / 1000 * 60)));
    if (frame.disposalType === 2) {
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const target = ((top + y) * width + left + x) * 4;
        canvas.fill(0, target, target + 4);
      }
    } else if (frame.disposalType === 3 && restore) {
      canvas = restore;
      restore = null;
    }
  }
  return { width, height, frames, durations };
}

function extractFrameShapes(frame: Uint8ClampedArray, width: number, height: number): Map<string, Form[]> {
  const colors = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < frame.length; i += 4) {
    if (frame[i + 3] !== 0) {
      const color: [number, number, number, number] = [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]];
      colors.set(colorKey(color), color);
    }
  }
  const result = new Map<string, Form[]>();
  for (const color of colors.values()) {
    const visited = new Uint8Array((height + 1) * (width + 1));
    const matches = (y: number, x: number) => {
      if (y < 0 || x < 0 || y >= height || x >= width) return false;
      const i = (y * width + x) * 4;
      return frame[i + 3] !== 0 && frame[i] === color[0] && frame[i + 1] === color[1] && frame[i + 2] === color[2];
    };
    for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
      if (!matches(sy, sx) || visited[sy * (width + 1) + sx]) continue;
      const queue: Point[] = [[sy, sx]];
      visited[sy * (width + 1) + sx] = 1;
      const pixels: Point[] = [];
      while (queue.length) {
        const [y, x] = queue.shift()!;
        pixels.push([y, x]);
        for (const [dy, dx] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
          const ny = y + dy, nx = x + dx;
          if (matches(ny, nx) && !visited[ny * (width + 1) + nx]) {
            visited[ny * (width + 1) + nx] = 1;
            queue.push([ny, nx]);
          }
        }
      }
      const minY = Math.min(...pixels.map(p => p[0]));
      const minX = Math.min(...pixels.map(p => p[1]));
      const normalized = pixels.map(([y, x]) => [y - minY, x - minX] as Point).sort((a, b) => key(a).localeCompare(key(b)));
      const id = shapeKey(normalized);
      const forms = result.get(id) ?? [];
      forms.push({ pos: [minY, minX], color });
      result.set(id, forms);
    }
  }
  return result;
}

const dirs: Record<string, Point> = { U: [-1, 0], R: [0, 1], D: [1, 0], L: [0, -1] };
const right: Record<string, string> = { U: "R", R: "D", D: "L", L: "U" };
const left: Record<string, string> = { U: "L", L: "D", D: "R", R: "U" };
function contour(shape: Point[]): Point[][] {
  const set = new Set(shape.map(key));
  const borders = new Map<string, Set<string>>();
  for (const pixel of shape) for (const [name, delta] of Object.entries(dirs)) {
    const adjacent: Point = [pixel[0] + delta[0], pixel[1] + delta[1]];
    if (set.has(key(adjacent))) continue;
    const borderDir = right[name];
    const bd = dirs[borderDir];
    const start: Point = [Math.trunc((pixel[0] + adjacent[0] - bd[0]) / 2 + 0.5), Math.trunc((pixel[1] + adjacent[1] - bd[1]) / 2 + 0.5)];
    const entry = borders.get(key(start)) ?? new Set<string>();
    entry.add(borderDir); borders.set(key(start), entry);
  }
  const cycles: Point[][] = [];
  while (borders.size) {
    const start = parseKey(borders.keys().next().value);
    let point = start;
    let dir = "R";
    const next = () => {
      const available = borders.get(key(point))!;
      let candidate = right[dir];
      while (!available.has(candidate)) candidate = left[candidate];
      available.delete(candidate); if (!available.size) borders.delete(key(point));
      const d = dirs[candidate]; point = [point[0] + d[0], point[1] + d[1]]; return candidate;
    };
    dir = next();
    const cycle: Point[] = [point];
    let last = dir;
    while (key(point) !== key(start)) {
      dir = next();
      if (dir === last) cycle[cycle.length - 1] = point; else cycle.push(point);
      last = dir;
    }
    cycles.push(cycle);
  }
  return cycles;
}

function closestIndex(source: Form, candidates: Form[]): number {
  let best = 0; let bestTuple: [number, number, number] | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const other = candidates[i];
    const dist = (source.pos[0] - other.pos[0]) ** 2 + (source.pos[1] - other.pos[1]) ** 2;
    const tuple: [number, number, number] = [dist > 0 ? 1 : 0, colorKey(source.color) === colorKey(other.color) ? dist : Infinity, dist];
    if (!bestTuple || tuple[0] < bestTuple[0] || (tuple[0] === bestTuple[0] && (tuple[1] < bestTuple[1] || (tuple[1] === bestTuple[1] && tuple[2] < bestTuple[2])))) { best = i; bestTuple = tuple; }
  }
  return best;
}
function staticValue(k: any) { return { k }; }
function animatedValue(values: any[], start: number, durations: number[]) {
  let last: any = undefined; const frames: any[] = []; let time = start;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value != null && JSON.stringify(value) !== JSON.stringify(last)) { frames.push({ t: Math.round(time), s: value, h: 1 }); last = value; }
    time += durations[i] ?? 0;
  }
  return frames.length === 1 ? staticValue(frames[0].s) : { a: 1, k: frames };
}
function lottiePos(pos: Point): Point { return [pos[1], pos[0]]; }
function lottieColor(color: [number, number, number, number]): number[] { return color.slice(0, 3).map(v => Math.round(v) / 255).map(v => Math.round(v * 1000) / 1000); }
function transformProperty(value: any, fallback: any) { return value && typeof value === "object" && "k" in value ? { a: value.a ?? 0, k: value.k } : { a: 0, k: value ?? fallback }; }
function normalize(animation: any) {
  for (const layer of animation.layers ?? []) {
    layer.ddd ??= 0; layer.ind ??= 1; layer.st ??= 0;
    layer.ks ??= {}; layer.ks.p = transformProperty(layer.ks.p, [0, 0, 0]); layer.ks.s = transformProperty(layer.ks.s, [100, 100, 100]);
    layer.ks.a = transformProperty(layer.ks.a, [0, 0, 0]); layer.ks.r = transformProperty(layer.ks.r, 0); layer.ks.o = transformProperty(layer.ks.o, 100);
    for (const group of layer.shapes ?? []) for (const item of group.it ?? []) {
      if (item.ty === "sh") { item.ks ??= {}; item.ks.a ??= 0; const k = item.ks.k; if (k && typeof k === "object" && !Array.isArray(k)) { k.i = (k.i ?? []).map((p: any) => Array.isArray(p) && p.length ? p : [0, 0]); k.o = (k.o ?? []).map((p: any) => Array.isArray(p) && p.length ? p : [0, 0]); } }
      if (item.ty === "st") { item.c = transformProperty(item.c, [0, 0, 0]); item.o = transformProperty(item.o, 100); item.w = transformProperty(item.w, 0); }
      if (item.ty === "fl") { item.c = transformProperty(item.c, [1, 1, 1]); item.o = transformProperty(item.o, 100); }
      if (item.ty === "tr") { item.a = transformProperty(item.a, [0, 0]); item.p = transformProperty(item.p, [0, 0]); item.s = transformProperty(item.s, [100, 100]); item.r = transformProperty(item.r, 0); item.o = transformProperty(item.o, 100); }
    }
  }
  return animation;
}
function buildAnimation(width: number, height: number, rgbaFrames: Uint8ClampedArray[], durations: number) {
  const frameShapes = rgbaFrames.map(frame => extractFrameShapes(frame, width, height));
  const records = new Map<string, ShapeRecord>();
  for (const map of frameShapes) for (const [id, forms] of map) if (!records.has(id)) records.set(id, { shape: id.split(";").filter(Boolean).map(parseKey), frames: [] });
  for (const record of records.values()) record.frames = frameShapes.map(map => map.get(shapeKey(record.shape)) ?? []);
  const scale = 512 / Math.max(width, height);
  const shift: Point = width > height ? [0, (1 - height / width) * 256] : [(1 - width / height) * 256, 0];
  const groups: any[] = [];
  for (const record of records.values()) {
    const outlines = contour(record.shape).map(cycle => ({ ty: "sh", ks: staticValue({ i: cycle.map(() => [0, 0]), o: cycle.map(() => [0, 0]), v: cycle.map(lottiePos), c: true }) }));
    for (let start = 0; start < record.frames.length; start++) for (const initial of record.frames[start]) {
      const chain: Array<Form | null> = [initial]; let last = initial;
      const remaining = record.frames.slice(start + 1).map(frame => frame.slice());
      for (const candidates of remaining) { if (!candidates.length) chain.push(null); else { const index = closestIndex(last, candidates); last = candidates.splice(index, 1)[0]; chain.push(last); } }
      const timeShift = record.frames.slice(0, start).reduce((a, _, i) => a + durations, 0);
      const opacity = animatedValue(chain.map(v => v ? 100 : 0), 0, Array(chain.length).fill(durations));
      const position = animatedValue(chain.map(v => v ? lottiePos(v.pos) : null), timeShift, Array(chain.length).fill(durations));
      const color = animatedValue(chain.map(v => v ? lottieColor(v.color) : null), timeShift, Array(chain.length).fill(durations));
      groups.push({ ty: "gr", it: [...outlines, { ty: "mm", mm: 1 }, { ty: "st", c: color, o: staticValue(50), w: staticValue(0.5 / scale) }, { ty: "fl", c: color }, { ty: "tr", p: position, o: opacity }] });
    }
  }
  return normalize({ v: "5.7.2", fr: 60, ip: 0, op: rgbaFrames.length * durations, w: 512, h: 512, nm: "SEGA TGS STUDIO", layers: [{ ty: 4, ks: { p: staticValue(shift), s: staticValue([100 * scale, 100 * scale]) }, shapes: groups, ip: 0, op: rgbaFrames.length * durations }] });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST a GIF file to convert." }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length) throw new Error("No GIF payload received.");
    if (body.length > MAX_INPUT) throw new Error("Input rejected: maximum GIF size is 8 MB.");
    const source = composeGif(body.buffer);
    if (!source.frames.length) throw new Error("GIF could not be read: no frames found.");
    const duration = source.durations[0] ?? 1;
    const animation = buildAnimation(source.width, source.height, source.frames, duration);
    const json = JSON.stringify(animation);
    const output = pako.gzip(json);
    if (output.byteLength > MAX_OUTPUT) throw new Error(`TGS output is ${Math.ceil(output.byteLength / 1024)} KB. Telegram allows a maximum of 64 KB; try a shorter or simpler GIF.`);
    const name = decodeURIComponent(req.headers.get("x-file-name") || "sticker.gif").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.gif$/i, ".tgs");
    const headers = { ...CORS, "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "X-TGS-Size": String(output.byteLength), "X-TGS-FPS": "60", "X-TGS-Frames": String(animation.op), "X-TGS-Duration": (Number(animation.op) / 60).toFixed(2), "X-TGS-Width": "512", "X-TGS-Height": "512" };
    return new Response(output, { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Conversion failed." }), { status: 422, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
