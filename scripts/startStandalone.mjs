// Starts KelFront as one self-contained server: production mode, guest
// players, no account API, no nginx (see src/server/StandaloneProxy.ts).
//
//   npm run host              build, then start on http://localhost:3000
//   npm run start:standalone  start an existing build
//
// Any variable already set in the environment wins over these defaults, so a
// host (Render, see render.yaml) can override them.
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitCommit() {
  if (process.env.RENDER_GIT_COMMIT) {
    return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root })
      .toString()
      .trim();
  } catch {
    return "standalone";
  }
}

const defaults = {
  GAME_ENV: "prod",
  // KelFront has no account API, so everyone plays as a guest.
  ALLOW_GUESTS: "true",
  NUM_WORKERS: "1",
  INSTANCE_LETTER: "a",
  DOMAIN: process.env.RENDER_EXTERNAL_HOSTNAME ?? "localhost",
  // Cloudflare's public always-pass Turnstile test key: there is no API to
  // verify a real challenge against.
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  API_KEY: "kelfront-standalone",
  GIT_COMMIT: gitCommit(),
};

const env = { ...process.env };
for (const [key, value] of Object.entries(defaults)) {
  env[key] ??= value;
}

console.log(
  `Starting KelFront (${env.NUM_WORKERS} worker(s)) on http://localhost:3000`,
);

// `node --import tsx` rather than the tsx CLI: no extra wrapper process, and
// cluster workers inherit the loader through execArgv.
const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join("src", "server", "Server.ts")],
  { cwd: root, env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
