#!/usr/bin/env node
/**
 * Gateway HTTP/WS: porta pública → Next (app) + noVNC/websockify.
 * /novnc/* e /websockify → NOVNC_PORT
 * resto → APP_PORT
 */
import http from "node:http";
import net from "node:net";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 3000);
const APP_PORT = Number(process.env.APP_PORT || 3001);
const NOVNC_PORT = Number(process.env.NOVNC_PORT || 6080);
const APP_HOST = "127.0.0.1";
const NOVNC_HOST = "127.0.0.1";

function isNovncPath(url = "") {
  return (
    url.startsWith("/novnc") ||
    url.startsWith("/websockify") ||
    url.startsWith("/vnc.html") ||
    url.startsWith("/vnc_lite.html") ||
    url.startsWith("/app/") ||
    url.startsWith("/core/") ||
    url.startsWith("/vendor/")
  );
}

function rewriteNovncUrl(url = "/") {
  if (url.startsWith("/novnc")) {
    const rest = url.slice("/novnc".length) || "/";
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return url;
}

function proxyHttp(req, res, host, port, pathOverride) {
  const headers = { ...req.headers, host: `${host}:${port}` };
  const options = {
    hostname: host,
    port,
    path: pathOverride ?? req.url,
    method: req.method,
    headers,
  };

  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });

  upstream.on("error", (err) => {
    console.error("[gateway] proxy error", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end("Bad gateway");
  });

  req.pipe(upstream);
}

function proxyWs(req, socket, head, host, port, pathOverride) {
  const target = net.connect(port, host, () => {
    const path = pathOverride ?? req.url ?? "/";
    let payload = `${req.method} ${path} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      const v = Array.isArray(value) ? value.join(", ") : value;
      payload += `${key}: ${v}\r\n`;
    }
    payload += "\r\n";
    target.write(payload);
    if (head?.length) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });

  target.on("error", (err) => {
    console.error("[gateway] ws proxy error", err.message);
    socket.destroy();
  });
  socket.on("error", () => target.destroy());
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (isNovncPath(url)) {
    proxyHttp(req, res, NOVNC_HOST, NOVNC_PORT, rewriteNovncUrl(url));
    return;
  }
  proxyHttp(req, res, APP_HOST, APP_PORT);
});

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "/";
  if (isNovncPath(url) || url.includes("websockify")) {
    proxyWs(req, socket, head, NOVNC_HOST, NOVNC_PORT, rewriteNovncUrl(url));
    return;
  }
  proxyWs(req, socket, head, APP_HOST, APP_PORT);
});

server.listen(GATEWAY_PORT, () => {
  console.log(
    `[gateway] :${GATEWAY_PORT} → next :${APP_PORT}, novnc :${NOVNC_PORT}`
  );
});
