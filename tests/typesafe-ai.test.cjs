"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAppServer, typeSafePayload, validateDecision } = require("../server.cjs");

function gameContext() {
  const ctx = vm.createContext({
    console,
    Math,
    performance,
    structuredClone,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ configured: true }) }),
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {} },
    requestAnimationFrame() {},
    document: { querySelector: () => null },
  });
  for (const name of ["official-data", "data", "combat"])
    vm.runInContext(fs.readFileSync(`js/${name}.js`, "utf8"), ctx);
  vm.runInContext("const UI=new Proxy({selected:null,blocking:false},{get(o,k){return k in o?o[k]:()=>{};}});", ctx);
  vm.runInContext(fs.readFileSync("js/game.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync("js/typesafe-ai.js", "utf8"), ctx);
  return (source) => vm.runInContext(source, ctx);
}

test("TypeSafe request is one bounded Choice over legal action ids", () => {
  const input = validateDecision({
    state: { gold: 10 },
    actions: [
      { id: "buy:0", description: "购买盖伦" },
      { id: "wait", description: "保留经济" },
    ],
  });
  const body = typeSafePayload(input, "jev-latest");
  assert.equal(body.model, "jev-latest");
  assert.equal(body.questions.next_action.type, "choice");
  assert.deepEqual(Object.keys(body.questions.next_action.criteria), ["buy:0", "wait"]);
  assert.throws(() => validateDecision({ state: {}, actions: [{ id: "x", description: "x" }] }), /2 到 200/);
});

test("local server hides the key and returns a validated Jev decision", async (t) => {
  let upstream;
  const server = createAppServer({
    apiKey: "secret-not-for-browser",
    fetchImpl: async (url, request) => {
      upstream = { url, headers: request.headers, body: JSON.parse(request.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "jev-test",
          answers: { next_action: { type: "choice", choice: "wait", confidence: 0.84, probabilities: { "buy:0": 0.16, wait: 0.84 } } },
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${base}/api/typesafe/status`).then((r) => r.json());
  assert.deepEqual(status, { configured: true, model: "jev-latest", skill: "typesafe-ai" });
  assert.equal(JSON.stringify(status).includes("secret-not-for-browser"), false);
  const response = await fetch(`${base}/api/typesafe/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: { gold: 10 }, actions: [{ id: "buy:0", description: "购买盖伦" }, { id: "wait", description: "保留经济" }] }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).action, "wait");
  assert.equal(upstream.headers.authorization, "Bearer secret-not-for-browser");
  assert.equal(upstream.body.questions.next_action.criteria.wait, "保留经济");
});

test("web configuration persists the Jev key locally without echoing it", async (t) => {
  const configPath = path.join(os.tmpdir(), `jcc-typesafe-${process.pid}-${Date.now()}.json`);
  const server = createAppServer({ configPath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    fs.rmSync(configPath, { force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/typesafe/status`).then((r) => r.json())).configured, false);
  const apiKey = "jev_local_test_secret_123";
  const response = await fetch(`${base}/api/typesafe/config`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ apiKey }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { configured: true });
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), { apiKey });
  assert.equal((await fetch(`${base}/api/typesafe/status`).then((r) => r.json())).configured, true);
});

test("AI exposes legal carousel and preparation actions and applies them through Game", () => {
  const run = gameContext();
  run("Game.newGame(); G.muted=true;");
  const carousel = run("TypeSafeAI.actions()");
  assert.ok(carousel.length >= 2);
  assert.ok(carousel.every((action) => action.id.startsWith("carousel:")));
  run(`TypeSafeAI.apply(${JSON.stringify(carousel[0].id)})`);
  assert.equal(run("G.phase"), "prep");
  assert.doesNotThrow(() => run("TypeSafeAI.state()"));
  run("G.gold=20; G.pool.Garen--; G.board['2,4']=Game.unit('Garen'); UI.render();");
  const prep = run("TypeSafeAI.actions()");
  assert.ok(prep.some((action) => action.id === "xp"));
  assert.ok(prep.some((action) => action.id === "reroll"));
  assert.ok(prep.some((action) => action.id === "ready"));
  assert.equal(prep.some((action) => action.id === "wait"), false);
  assert.ok(prep.some((action) => action.id.startsWith("formation:")));
  const before = run("G.gold");
  run("TypeSafeAI.apply('xp')");
  assert.equal(run("G.gold"), before - 4);
  const roster = run("Object.values(G.board).map(u=>u.uid).sort().join(',')");
  run("TypeSafeAI.apply('formation:spread')");
  assert.equal(run("Object.values(G.board).map(u=>u.uid).sort().join(',')"), roster);
  assert.equal(run("TypeSafeAI.actions().some(a=>a.id.startsWith('formation:'))"), false);
  run("TypeSafeAI.apply('ready')");
  assert.equal(run("G.phase"), "combat");
});
