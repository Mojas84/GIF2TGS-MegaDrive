import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, safeFilename } from "../gif-utils";

const ROOT = path.resolve(import.meta.dirname, "../..");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function runConverter(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const pythonBinary = process.env.PYTHON_BIN || "python3";
    const child = spawn(pythonBinary, ["-m", "pixelart2tgs", "-i", inputPath, outputPath, "-y"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Converter exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function convertGif(req: express.Request, res: express.Response) {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
  if (body.length === 0) return res.status(400).json({ error: "No GIF payload received." });
  if (body.length > MAX_INPUT_BYTES) return res.status(413).json({ error: "Input rejected: maximum GIF size is 8 MB." });

  const token = randomUUID();
  const inputPath = path.join("/tmp", `${token}.gif`);
  const outputPath = path.join("/tmp", `${token}.tgs`);
  const outputName = safeFilename(req.header("x-file-name")).replace(/\.gif$/i, ".tgs");

  try {
    await fs.writeFile(inputPath, body);
    await runConverter(inputPath, outputPath);
    const stat = await fs.stat(outputPath);
    if (stat.size > MAX_OUTPUT_BYTES) {
      return res.status(422).json({ error: `TGS output is ${Math.ceil(stat.size / 1024)} KB. Telegram allows a maximum of 64 KB; try a shorter or simpler GIF.` });
    }
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${outputName}"`);
    res.setHeader("X-TGS-Size", String(stat.size));
    const output = await fs.readFile(outputPath);
    return res.status(200).send(output);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown converter error.";
    return res.status(422).json({ error: detail.replace(/^File reading error:\s*/i, "GIF could not be read: ") });
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "gif2tgs" }));
  app.post("/api/convert", express.raw({ type: ["image/gif", "application/octet-stream"], limit: "8mb" }), convertGif);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);
  server.listen(port, () => console.log(`Server running on http://localhost:${port}/`));
}

startServer().catch(error => { console.error(error); process.exitCode = 1; });
