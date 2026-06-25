import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const portArgIndex = process.argv.indexOf("--port");
const hostArgIndex = process.argv.indexOf("--host");
const port = Number(process.env.PORT || (portArgIndex >= 0 ? process.argv[portArgIndex + 1] : 5173));
const host = process.env.HOST || (hostArgIndex >= 0 ? process.argv[hostArgIndex + 1] : "0.0.0.0");
const rootDir = resolve(process.cwd());

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function resolvePublicPath(pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(rootDir, cleanPath));

  // Block path traversal.
  if (!filePath.startsWith(rootDir)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const filePath = resolvePublicPath(url.pathname);

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const contentType = contentTypes[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`frontend listening on http://${host}:${port}`);
});
