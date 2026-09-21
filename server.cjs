"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname);
const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_CONFIG = path.join(ROOT, ".typesafe.local.json");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
};

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
    "cache-control": "no-store",
  });
  res.end(data);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSON 格式无效"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function loadLocalApiKey(configPath = DEFAULT_CONFIG) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  } catch {
    return "";
  }
}

function saveLocalApiKey(apiKey, configPath = DEFAULT_CONFIG) {
  const temporary = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ apiKey }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, configPath);
}

function validateDecision(body) {
  if (!body || typeof body.state !== "object" || Array.isArray(body.state))
    throw Object.assign(new Error("缺少有效的游戏状态"), { status: 400 });
  if (!Array.isArray(body.actions) || body.actions.length < 2 || body.actions.length > 200)
    throw Object.assign(new Error("合法动作数量必须在 2 到 200 之间"), { status: 400 });
  const seen = new Set();
  const actions = body.actions.map((action) => {
    const id = String(action?.id || "");
    const description = String(action?.description || "");
    if (!id || id.length > 100 || !description || description.length > 500 || seen.has(id))
      throw Object.assign(new Error("动作列表包含无效或重复项"), { status: 400 });
    seen.add(id);
    return { id, description };
  });
  return { state: body.state, actions };
}

function typeSafePayload(input, model) {
  return {
    state: input.state,
    model,
    questions: {
      next_action: {
        type: "choice",
        instructions: {
          role: "你是自走棋《金铲铲》的夺冠决策器。唯一目标是最大化本局最终获得第一名的概率，不是尽快选完，也不是尽快开战。根据完整状态和每个合法动作的结果，选择当前最有战略价值的一步。只返回一个选项键，不解释。",
          priorities: [
            "先判断当前阵容强度、血量压力和对手；需要止血时优先即时战力，健康时可以用利息换取长期等级与高费核心",
            "购买与换人要同时考虑升星进度、有效羁绊阈值、英雄费用/强度、人口上限和备战席空间，不为无关单卡破坏核心阵容",
            "装备要匹配英雄职责与技能：输出装给核心输出，法力/法强装给依赖技能的英雄，防御装给前排；避免把稀缺装备浪费在过渡弱卡上",
            "站位要针对攻击距离和对手阵容：前排承伤、后排输出受保护，并在需要时用分散站位降低范围伤害风险",
            "金币要考虑每10金币1利息、升级后的上阵人口和商店概率；刷新必须有明确追卡或止血收益",
            "只有当本轮继续购买、升级、刷新、换阵、装备或站位的预期收益都低于保留资源时，才选择准备就绪",
            "所有选项都已通过游戏规则校验；必须且只能选择一个选项键",
          ],
          decision_rule: "比较每个动作对本回合胜率和整局夺冠概率的综合影响。短期与长期冲突时，根据生命值、连胜/连败、阶段和对手强度权衡。",
        },
        criteria: Object.fromEntries(input.actions.map((a) => [a.id, a.description])),
      },
    },
  };
}

async function requestTypeSafe(input, options = {}) {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw Object.assign(new Error("未配置 TYPESAFE_API_KEY"), { status: 503 });
  const endpoint = options.endpoint || process.env.TYPESAFE_ENDPOINT || DEFAULT_ENDPOINT;
  const model = options.model || process.env.TYPESAFE_MODEL || "jev-latest";
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(typeSafePayload(input, model)),
      signal: AbortSignal.timeout(12_000),
    });
    if (![429, 529].includes(response.status) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail?.message || data?.detail || data?.message || `TypeSafe API 返回 ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status >= 500 ? 502 : response.status });
  }
  const answer = data?.answers?.next_action;
  if (answer?.type !== "choice" || !input.actions.some((a) => a.id === answer.choice))
    throw Object.assign(new Error("TypeSafe 返回了无效动作"), { status: 502 });
  return {
    action: answer.choice,
    confidence: Number(answer.confidence) || 0,
    probability: Number(answer.probabilities?.[answer.choice]) || 0,
    model: data.model || model,
    usage: data.usage || null,
  };
}

function staticFile(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(ROOT, relative);
  return file === ROOT || file.startsWith(ROOT + path.sep) ? file : null;
}

function createAppServer(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG;
  let runtimeApiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? loadLocalApiKey(configPath);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/typesafe/status" && req.method === "GET") {
      return json(res, 200, {
        configured: Boolean(runtimeApiKey),
        model: options.model || process.env.TYPESAFE_MODEL || "jev-latest",
        skill: "typesafe-ai",
      });
    }
    if (url.pathname === "/api/typesafe/config" && req.method === "POST") {
      try {
        if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
          throw Object.assign(new Error("配置请求必须使用 JSON"), { status: 415 });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`)
          throw Object.assign(new Error("拒绝跨站配置请求"), { status: 403 });
        const body = await readJson(req, 8 * 1024);
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        if (apiKey.length < 10 || apiKey.length > 500)
          throw Object.assign(new Error("请输入有效的 Jev API 密钥"), { status: 400 });
        saveLocalApiKey(apiKey, configPath);
        runtimeApiKey = apiKey;
        return json(res, 200, { configured: true });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message || "保存配置失败" });
      }
    }
    if (url.pathname === "/api/typesafe/decide" && req.method === "POST") {
      try {
        const input = validateDecision(await readJson(req));
        return json(res, 200, await requestTypeSafe(input, { ...options, apiKey: runtimeApiKey }));
      } catch (error) {
        return json(res, error.status || 500, { error: error.message || "AI 决策失败" });
      }
    }
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "Method Not Allowed" });
    const file = staticFile(url.pathname);
    if (!file) return json(res, 403, { error: "Forbidden" });
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) return json(res, 404, { error: "Not Found" });
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": stat.size,
        "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=300",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8765;
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(`金铲铲已启动：http://127.0.0.1:${port}/`);
    const configured = process.env.TYPESAFE_API_KEY || loadLocalApiKey();
    console.log(configured ? "TypeSafe Jev：已配置" : "TypeSafe Jev：未配置，可在网页中填写");
  });
}

module.exports = { createAppServer, loadLocalApiKey, requestTypeSafe, saveLocalApiKey, typeSafePayload, validateDecision };
