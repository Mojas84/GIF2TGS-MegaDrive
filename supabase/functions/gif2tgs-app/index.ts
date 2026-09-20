import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STORAGE_BASE = "https://ruffononhafqhxqwurhq.supabase.co/storage/v1/object/public/gif2tgs-site";
const CONTENT_TYPES: Record<string, string> = {
  ".html": "application/xhtml+xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function headers(contentType: string) {
  return { "Content-Type": contentType, "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: headers("text/plain") });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: headers("text/plain") });
  const url = new URL(req.url);
  const lastSegment = url.pathname.split("/").filter(Boolean).pop() || "";
  const requested = url.searchParams.get("file") || (lastSegment.includes(".") ? lastSegment : "index.html");
  const file = requested.replace(/^\/+/, "");
  const storageResponse = await fetch(`${STORAGE_BASE}/${file}`);
  if (!storageResponse.ok) return new Response("Not Found", { status: 404, headers: headers("text/plain") });
  const extension = file.includes(".") ? `.${file.split(".").pop()!.toLowerCase()}` : ".html";
  const type = CONTENT_TYPES[extension] || "application/octet-stream";
  if (type.startsWith("text/") || type.startsWith("application/xhtml")) {
    let text = await storageResponse.text();
    if (file === "index.html") text = text.replace(/\.\/index-([^\"']+\.js)/g, "?file=index-$1").replace(/\.\/index-([^\"']+\.css)/g, "?file=index-$1");
    if (file.endsWith(".js")) text = text.replaceAll("/mascot.png", "?file=mascot.png");
    return new Response(text, { status: 200, headers: headers(type) });
  }
  return new Response(await storageResponse.arrayBuffer(), { status: 200, headers: headers(type) });
});
