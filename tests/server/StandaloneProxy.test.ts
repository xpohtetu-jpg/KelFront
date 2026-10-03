import { describe, expect, test } from "vitest";
import { workerTarget } from "../../src/server/StandaloneProxy";

// The standalone master routes what nginx.conf would: /wN/* to worker N with
// the prefix stripped, game-creation POSTs to a random worker, nothing else.
describe("workerTarget", () => {
  test("routes /wN/* to worker N's port with the prefix stripped", () => {
    expect(workerTarget("/w0/game/abc?live", 2)).toEqual({
      port: 3001,
      path: "/game/abc?live",
    });
    expect(workerTarget("/w1/api/game/abc/exists", 2)).toEqual({
      port: 3002,
      path: "/api/game/abc/exists",
    });
  });

  test("a bare /wN maps to the worker root, keeping the query", () => {
    expect(workerTarget("/w0", 1)).toEqual({ port: 3001, path: "/" });
    expect(workerTarget("/w0?x=1", 1)).toEqual({ port: 3001, path: "/?x=1" });
  });

  test("refuses workers that do not exist", () => {
    expect(workerTarget("/w2/game/abc", 2)).toBeNull();
  });

  test("ignores paths that only start like a worker prefix", () => {
    expect(workerTarget("/w0abc", 2)).toBeNull();
    expect(workerTarget("/wiki", 2)).toBeNull();
    expect(workerTarget("/", 2)).toBeNull();
    expect(workerTarget("/api/health", 2)).toBeNull();
  });

  test("sends game creation to a random worker, path unchanged", () => {
    expect(workerTarget("/api/create_game", 3, () => 0)).toEqual({
      port: 3001,
      path: "/api/create_game",
    });
    expect(workerTarget("/api/create_game?x=1", 3, () => 0.99)).toEqual({
      port: 3003,
      path: "/api/create_game?x=1",
    });
    expect(workerTarget("/api/adminbot/create_game", 3, () => 0.5)).toEqual({
      port: 3002,
      path: "/api/adminbot/create_game",
    });
  });
});
