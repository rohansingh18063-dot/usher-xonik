// Serves the public API domain check page on its own port, so it can be
// opened from two different origins:
//
//   http://localhost:5500/   allowed when the client's test mode is on and
//                            localhost is on their allowed domains
//   http://127.0.0.1:5500/   never allowed (IP addresses are always rejected)
//
// Run with: npm run test:page [-- --port 5500]

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const index = process.argv.indexOf("--port");
const port = Number(index > -1 ? process.argv[index + 1] : 5500);
const page = readFileSync(new URL("../tests/public-api/domain-check.html", import.meta.url));

export function serveTestPage(listenPort = port) {
  const server = createServer((request, response) => {
    if (new URL(request.url, "http://local").pathname !== "/") {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(page);
  });
  return new Promise((resolve) => server.listen(listenPort, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serveTestPage();
  console.log(`Domain check page:\n  http://localhost:${port}/   (allowed in test mode)\n  http://127.0.0.1:${port}/   (always blocked)`);
}
