// Serves the sample clinic website (tests/widget/site) with the widget's
// embed code filled in, so the widget can be tried on a "real" website.
//
// Run with: npm run test:site -- --key pk_live_... [--port 5600] [--app http://localhost:3000]
//
// Then turn on Test mode, add localhost on the API Key page, and open
// http://localhost:5600. Opened as http://127.0.0.1:5600 the widget must not
// appear, because that address is not an allowed domain.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const SITE = new URL("../tests/widget/site/", import.meta.url);
const FILES = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/about.html": ["about.html", "text/html"],
  "/hostile.css": ["hostile.css", "text/css"],
};

export function serveSampleSite({ port, key, widgetSrc }) {
  const server = createServer((request, response) => {
    const file = FILES[new URL(request.url, "http://local").pathname];
    if (!file) {
      response.writeHead(404).end("Not found");
      return;
    }
    const body = readFileSync(new URL(file[0], SITE), "utf8").replaceAll("{{WIDGET_SRC}}", widgetSrc).replaceAll("{{KEY}}", key);
    response.writeHead(200, { "Content-Type": `${file[1]}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(body);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : fallback;
  };
  const key = argument("--key", "");
  const port = Number(argument("--port", 5600));
  const app = argument("--app", "http://localhost:3000").replace(/\/$/, "");
  if (!key) {
    console.error("Pass your public key: npm run test:site -- --key pk_live_...");
    process.exit(1);
  }
  await serveSampleSite({ port, key, widgetSrc: `${app}/widget.js` });
  console.log(`Sample website:\n  http://localhost:${port}/   (allowed in test mode)\n  http://127.0.0.1:${port}/   (not allowed)`);
}
