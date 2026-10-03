import type { Express, NextFunction, Request, Response } from "express";
import http from "http";
import net from "net";
import { ServerEnv } from "./ServerEnv";

// Lets the master serve a whole deployment on its own port, with no nginx in
// front: a single container, or a PC behind a tunnel.
//
// nginx.conf routes /wN/* (HTTP and WebSocket) to worker N with the /wN
// prefix stripped, and spreads the game-creation POSTs over random workers.
// This does the same. Behind nginx none of these requests reach the master,
// so these handlers are never hit there.

const WORKER_PATH = /^\/w(\d+)(\/[^?]*)?(\?.*)?$/i;
const RANDOM_WORKER_PATHS = new Set([
  "/api/create_game",
  "/api/adminbot/create_game",
  "/api/adminbot/create_pool",
]);

interface Target {
  port: number;
  path: string;
}

export function workerTarget(
  url: string,
  numWorkers: number,
  random: () => number = Math.random,
): Target | null {
  const match = WORKER_PATH.exec(url);
  if (match) {
    const index = Number(match[1]);
    if (index >= numWorkers) return null;
    return {
      port: ServerEnv.workerPortByIndex(index),
      path: (match[2] ?? "/") + (match[3] ?? ""),
    };
  }
  const pathname = url.split("?")[0];
  if (RANDOM_WORKER_PATHS.has(pathname)) {
    const index = Math.floor(random() * numWorkers);
    return { port: ServerEnv.workerPortByIndex(index), path: url };
  }
  return null;
}

// The headers nginx adds, so workers see the player's address and scheme.
function forwardedHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const remote = req.socket.remoteAddress ?? "";
  const prior = req.headers["x-forwarded-for"];
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  headers["x-forwarded-for"] = prior ? `${prior}, ${remote}` : remote;
  headers["x-real-ip"] ??= remote;
  headers["x-forwarded-proto"] ??= "http";
  return headers;
}

export function installStandaloneProxy(app: Express, server: http.Server) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const target = workerTarget(req.originalUrl, ServerEnv.numWorkers());
    if (target === null) return next();
    const proxyReq = http.request(
      {
        host: "127.0.0.1",
        port: target.port,
        method: req.method,
        path: target.path,
        headers: forwardedHeaders(req),
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(proxyReq);
  });

  // The master has no WebSocket endpoints of its own, so every upgrade is
  // either a worker's or refused.
  server.on("upgrade", (req, socket, head) => {
    const target = workerTarget(req.url ?? "", ServerEnv.numWorkers());
    if (target === null) {
      socket.destroy();
      return;
    }
    const upstream = net.connect(target.port, "127.0.0.1", () => {
      let raw = `${req.method} ${target.path} HTTP/1.1\r\n`;
      for (const [name, value] of Object.entries(forwardedHeaders(req))) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) {
          raw += `${name}: ${v}\r\n`;
        }
      }
      upstream.write(raw + "\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
}
