// Serves a built project as Vercel serves it: the files of its output directory, with the response
// headers of its vercel.json, /a/b answered from a/b/index.html, a trailing slash redirected, and
// 404.html for addresses without a file.
//
//   node serve.mjs [project directory] [port]
//
// The project directory defaults to this one (scan); the site is served with `node ../scan/serve.mjs .`
// from site/ after `node build.mjs --deploy`. Browsers permit the camera and the service worker on
// localhost without HTTPS.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".icc": "application/vnd.iccprofile",
};

/** The headers that vercel.json sets for a path; sources are matched as regular expressions. */
function headersFor(config, path) {
  const out = {};
  for (const rule of config.headers ?? []) {
    if (new RegExp(`^${rule.source}$`).test(path)) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

/** Starts a server for the project in `project` and resolves to its address. */
export function serve(project = fileURLToPath(new URL(".", import.meta.url)), port = 0) {
  const config = JSON.parse(readFileSync(join(project, "vercel.json"), "utf8"));
  const root = resolve(project, config.outputDirectory ?? "out");
  const file = (path) => {
    const target = normalize(join(root, path));
    if (!target.startsWith(root)) return undefined;
    if (existsSync(target) && statSync(target).isFile()) return target;
    const index = join(target, "index.html");
    return existsSync(index) ? index : undefined;
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path.length > 1 && path.endsWith("/")) {
      res.writeHead(308, { location: path.slice(0, -1) }).end();
      return;
    }
    const found = file(path);
    const target = found ?? file("/404.html");
    const status = found ? 200 : 404;
    if (target === undefined) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(status, { ...headersFor(config, path), "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(target));
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done({ server, url: `http://localhost:${server.address().port}/` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [project, port] = process.argv.slice(2);
  const { url } = await serve(project ? resolve(project) : undefined, Number(port ?? 8045));
  console.log(`serving ${url}; stop with Ctrl+C`);
}
