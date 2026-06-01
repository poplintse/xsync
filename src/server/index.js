import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  host: process.env.XSYNC_HOST ?? "127.0.0.1",
  port: Number(process.env.XSYNC_PORT ?? 8791),
  basePath: normalizeBasePath(process.env.XSYNC_BASE_PATH ?? "/xsync"),
  dataDir: process.env.XSYNC_DATA_DIR ?? join(__dirname, "../../.data"),
  authMode: process.env.AUTH_MODE ?? "sso_ticket",
  cookieSecure: normalizeBoolean(process.env.XSYNC_COOKIE_SECURE, false),
  cookieName: "xsync_session",
  xssoBaseUrl: trimTrailingSlash(process.env.XSSO_BASE_URL ?? "http://127.0.0.1:7000/xsso"),
  xssoAppCode: process.env.XSSO_APP_CODE ?? "xsync",
  xssoAppSecret: process.env.XSSO_APP_SECRET ?? "change-me",
  xssoLoginUrl: process.env.XSSO_LOGIN_URL ?? "/xsso/launch"
};

const storePath = join(config.dataDir, "store.json");
const sessions = new Map();
let store = await loadStore();

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "internal_error" });
  });
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(`xsync listening on http://${config.host}:${port}${config.basePath}`);
});

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const routePath = stripBasePath(url.pathname);
  if (routePath === null) return sendJson(res, 404, { error: "not_found" });

  if (req.method === "GET" && routePath === "/health") {
    return sendJson(res, 200, { ok: true, service: "xsync" });
  }

  if (req.method === "GET" && routePath === "/") {
    const session = getWebSession(req);
    if (!session) return redirectToXsso(res, "/");
    return sendHtml(res, renderHome(session.user));
  }

  if (req.method === "GET" && routePath === "/sso/callback") {
    return handleSsoCallback(req, res, url);
  }

  if (req.method === "GET" && routePath === "/device/authorize") {
    const session = getWebSession(req);
    if (!session) return redirectToXsso(res, "/device/authorize");
    const callbackUrl = safeDeviceCallbackUrl(url.searchParams.get("callback_url"));
    const code = createDeviceCode(session.user.id, {
      deviceName: url.searchParams.get("device_name") ?? "Chrome",
      platform: url.searchParams.get("platform") ?? "chrome"
    });
    await saveStore();
    return sendHtml(res, renderDeviceAuthorization(session.user, code, callbackUrl));
  }

  if (req.method === "POST" && routePath === "/api/device/authorize/start") {
    const session = getWebSession(req);
    if (!session) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJsonBody(req);
    const code = createDeviceCode(session.user.id, body);
    await saveStore();
    return sendJson(res, 201, {
      code,
      expires_in: 600
    });
  }

  if (req.method === "POST" && routePath === "/api/device/authorize/finish") {
    const body = await readJsonBody(req);
    return finishDeviceAuthorization(res, body);
  }

  if (req.method === "POST" && routePath === "/api/device/token/refresh") {
    const body = await readJsonBody(req);
    return refreshDeviceToken(res, body);
  }

  if (routePath.startsWith("/api/")) {
    const auth = authenticateApi(req);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    return handleApiRoute(req, res, routePath, auth);
  }

  sendJson(res, 404, { error: "not_found" });
}

async function handleApiRoute(req, res, routePath, auth) {
  if (req.method === "GET" && routePath === "/api/collections") {
    const collections = store.collections
      .filter((collection) => collection.userId === auth.user.id)
      .map(({ tree, ...collection }) => collection);
    return sendJson(res, 200, { collections });
  }

  const treeMatch = routePath.match(/^\/api\/collections\/([^/]+)\/tree$/);
  if (req.method === "GET" && treeMatch) {
    const collection = findUserCollection(auth.user.id, treeMatch[1]);
    if (!collection) return sendJson(res, 404, { error: "collection_not_found" });
    return sendJson(res, 200, {
      collection: withoutTree(collection),
      tree: collection.tree ?? null
    });
  }

  if (req.method === "POST" && routePath === "/api/sync/preview") {
    const body = await readJsonBody(req);
    const preview = buildSyncPreview(auth.user.id, body);
    return sendJson(res, 200, preview);
  }

  if (req.method === "POST" && routePath === "/api/sync/apply") {
    const body = await readJsonBody(req);
    const result = await applySync(auth, body);
    return sendJson(res, result.status, result.body);
  }

  sendJson(res, 404, { error: "not_found" });
}

async function handleSsoCallback(req, res, url) {
  const ticket = url.searchParams.get("ticket");
  const redirectPath = safeRelativeRedirect(url.searchParams.get("redirect"), "/");
  if (!ticket) return sendJson(res, 400, { error: "missing_ticket" });

  if (config.authMode === "local") {
    const user = upsertUser({
      xssoUserId: "local",
      username: "local",
      displayName: "Local User"
    });
    await saveStore();
    return createWebSessionAndRedirect(res, user, redirectPath);
  }

  const claims = await verifyXssoTicket(ticket);
  if (!claims.active) return sendJson(res, 401, { error: "invalid_ticket" });

  const mapped = claims.mapped_user ?? claims.xsso_user;
  const user = upsertUser({
    xssoUserId: String(claims.xsso_user?.id ?? mapped?.id ?? mapped?.username),
    username: String(mapped?.username ?? claims.xsso_user?.username ?? "user"),
    displayName: String(mapped?.display_name ?? mapped?.username ?? "User")
  });
  await saveStore();
  createWebSessionAndRedirect(res, user, redirectPath);
}

async function verifyXssoTicket(ticket) {
  const response = await fetch(`${config.xssoBaseUrl}/tickets/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_code: config.xssoAppCode,
      app_secret: config.xssoAppSecret,
      ticket
    })
  });
  if (!response.ok) return { active: false };
  return response.json();
}

function createDeviceCode(userId, body) {
  const code = randomToken(18);
  store.deviceCodes.push({
    codeHash: hashToken(code),
    userId,
    deviceName: String(body.device_name ?? body.deviceName ?? "Chrome"),
    platform: String(body.platform ?? "chrome"),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString()
  });
  return code;
}

async function finishDeviceAuthorization(res, body) {
  const code = String(body.code ?? "");
  const codeHash = hashToken(code);
  const record = store.deviceCodes.find((item) => item.codeHash === codeHash && !item.usedAt);
  if (!record) return sendJson(res, 401, { error: "invalid_device_code" });
  if (Date.parse(record.expiresAt) < Date.now()) return sendJson(res, 401, { error: "expired_device_code" });

  const user = store.users.find((item) => item.id === record.userId);
  if (!user) return sendJson(res, 401, { error: "invalid_user" });

  const accessToken = randomToken(32);
  const refreshToken = randomToken(40);
  const device = {
    id: nextId("device"),
    userId: user.id,
    name: record.deviceName,
    platform: record.platform,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    revokedAt: null,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  store.devices.push(device);
  record.usedAt = new Date().toISOString();
  await saveStore();

  return sendJson(res, 201, {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    device: publicDevice(device),
    user: publicUser(user)
  });
}

async function refreshDeviceToken(res, body) {
  const refreshToken = String(body.refresh_token ?? body.refreshToken ?? "");
  if (!refreshToken) return sendJson(res, 401, { error: "missing_refresh_token" });

  const refreshTokenHash = hashToken(refreshToken);
  const device = store.devices.find((item) => !item.revokedAt && safeEqual(item.refreshTokenHash, refreshTokenHash));
  if (!device) return sendJson(res, 401, { error: "invalid_refresh_token" });

  const user = store.users.find((item) => item.id === device.userId);
  if (!user) return sendJson(res, 401, { error: "invalid_user" });

  const nextAccessToken = randomToken(32);
  const nextRefreshToken = randomToken(40);
  device.accessTokenHash = hashToken(nextAccessToken);
  device.refreshTokenHash = hashToken(nextRefreshToken);
  device.lastSeenAt = new Date().toISOString();
  await saveStore();

  return sendJson(res, 200, {
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    token_type: "Bearer",
    device: publicDevice(device),
    user: publicUser(user)
  });
}

function buildSyncPreview(userId, body) {
  const mode = normalizeSyncMode(body.mode);
  const collection = findUserCollection(userId, body.collection_id ?? body.collectionId);
  const localTree = body.local_tree ?? body.localTree ?? null;
  const remoteTree = collection?.tree ?? null;
  return {
    mode,
    collection: collection ? withoutTree(collection) : null,
    summary: summarizeTrees(localTree, remoteTree),
    operations: []
  };
}

async function applySync(auth, body) {
  const mode = normalizeSyncMode(body.mode);
  const localTree = body.local_tree ?? body.localTree ?? null;
  if (!localTree || typeof localTree !== "object") {
    return { status: 400, body: { error: "missing_local_tree" } };
  }

  let collection = findUserCollection(auth.user.id, body.collection_id ?? body.collectionId);
  if (!collection) {
    collection = {
      id: nextId("collection"),
      userId: auth.user.id,
      name: String(body.collection_name ?? body.collectionName ?? localTree.title ?? "Bookmarks"),
      rootKey: String(localTree.stableId ?? localTree.id ?? "root"),
      revision: 0,
      tree: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.collections.push(collection);
  }

  if (mode === "server_over_local") {
    return {
      status: 200,
      body: {
        collection: withoutTree(collection),
        tree: collection.tree,
        summary: summarizeTrees(localTree, collection.tree)
      }
    };
  }

  const nextRevision = collection.revision + 1;
  const previousTree = collection.tree;
  const nextTree = mode === "merge" ? mergeTrees(previousTree, localTree) : localTree;
  collection.tree = nextTree;
  collection.revision = nextRevision;
  collection.updatedAt = new Date().toISOString();

  store.syncSnapshots.push({
    id: nextId("snapshot"),
    collectionId: collection.id,
    deviceId: auth.device.id,
    baseRevision: nextRevision - 1,
    newRevision: nextRevision,
    mode,
    summary: summarizeTrees(localTree, previousTree),
    createdAt: new Date().toISOString()
  });
  await saveStore();

  return {
    status: 200,
    body: {
      collection: withoutTree(collection),
      tree: collection.tree,
      summary: summarizeTrees(localTree, previousTree)
    }
  };
}

function mergeTrees(remoteTree, localTree) {
  if (!remoteTree) return localTree;
  if (!localTree) return remoteTree;
  const merged = structuredClone(localTree);
  const existingKeys = new Set(flattenTree(merged).map((node) => node.stableId ?? node.id ?? `${node.title}:${node.url ?? ""}`));
  const remoteChildren = Array.isArray(remoteTree.children) ? remoteTree.children : [];
  if (!Array.isArray(merged.children)) merged.children = [];
  for (const child of remoteChildren) {
    const key = child.stableId ?? child.id ?? `${child.title}:${child.url ?? ""}`;
    if (!existingKeys.has(key)) merged.children.push(child);
  }
  return merged;
}

function summarizeTrees(localTree, remoteTree) {
  return {
    local_nodes: countNodes(localTree),
    remote_nodes: countNodes(remoteTree),
    note: "minimal_preview"
  };
}

function countNodes(tree) {
  if (!tree) return 0;
  return flattenTree(tree).length;
}

function flattenTree(tree) {
  const nodes = [];
  walk(tree);
  return nodes;

  function walk(node) {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  }
}

function authenticateApi(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, error: "missing_token" };
  const tokenHash = hashToken(token);
  const device = store.devices.find((item) => !item.revokedAt && safeEqual(item.accessTokenHash, tokenHash));
  if (!device) return { ok: false, status: 401, error: "invalid_token" };
  const user = store.users.find((item) => item.id === device.userId);
  if (!user) return { ok: false, status: 401, error: "invalid_user" };
  device.lastSeenAt = new Date().toISOString();
  saveStore();
  return { ok: true, user, device };
}

function getWebSession(req) {
  const token = getCookie(req, config.cookieName);
  if (!token) return null;
  const session = sessions.get(hashToken(token));
  if (!session) return null;
  return session;
}

function createWebSessionAndRedirect(res, user, redirectPath) {
  const token = randomToken(32);
  sessions.set(hashToken(token), {
    user: publicUser(user),
    createdAt: new Date().toISOString()
  });
  res.statusCode = 302;
  res.setHeader("Set-Cookie", buildCookie(config.cookieName, token));
  res.setHeader("Location", withBasePath(redirectPath));
  res.end();
}

function redirectToXsso(res, redirectPath) {
  if (config.authMode === "local") {
    res.statusCode = 302;
    res.setHeader("Location", withBasePath(`/sso/callback?ticket=local&redirect=${encodeURIComponent(redirectPath)}`));
    res.end();
    return;
  }
  const redirect = withBasePath(redirectPath);
  res.statusCode = 302;
  res.setHeader("Location", `${config.xssoLoginUrl}?app=${encodeURIComponent(config.xssoAppCode)}&redirect=${encodeURIComponent(redirect)}`);
  res.end();
}

function renderHome(user) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>xsync</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f7f5;color:#1f2933}
main{max-width:880px;margin:48px auto;padding:0 24px}
section{border:1px solid #d8ddd5;background:#fff;border-radius:8px;padding:24px}
code{background:#eef1ed;padding:2px 5px;border-radius:4px}
</style>
<main>
  <h1>xsync</h1>
  <section>
    <p>已通过 xsso 登录：<strong>${escapeHtml(user.displayName || user.username)}</strong></p>
    <p>Chrome 扩展和托盘 App 可通过 <code>${config.basePath}/api/device/authorize/start</code> 完成设备授权。</p>
  </section>
</main>
</html>`;
}

function renderDeviceAuthorization(user, code, callbackUrl) {
  const callbackHref = callbackUrl ? appendQuery(callbackUrl, { code }) : "";
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>xsync 设备授权</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f7f5;color:#1f2933}
main{max-width:680px;margin:48px auto;padding:0 24px}
section{border:1px solid #d8ddd5;background:#fff;border-radius:8px;padding:24px}
.code{font-size:28px;letter-spacing:1px;background:#eef1ed;border-radius:8px;padding:16px;word-break:break-all}
p{line-height:1.6}
</style>
<main>
  <h1>xsync 设备授权</h1>
  <section>
    <p>当前 xsso 用户：<strong>${escapeHtml(user.displayName || user.username)}</strong></p>
    <p>请把下面的一次性授权码填入 Chrome 扩展或托盘 App：</p>
    <p class="code">${escapeHtml(code)}</p>
    ${callbackHref ? `<p><a href="${escapeHtml(callbackHref)}">返回 xsync 托盘 App</a></p>` : ""}
    <p>授权码 10 分钟内有效，使用一次后立即失效。</p>
  </section>
</main>
</html>`;
}

async function loadStore() {
  await mkdir(config.dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    return {
      nextIds: { user: 1, device: 1, collection: 1, snapshot: 1 },
      users: [],
      devices: [],
      deviceCodes: [],
      collections: [],
      syncSnapshots: []
    };
  }
}

async function saveStore() {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function upsertUser(input) {
  let user = store.users.find((item) => item.xssoUserId === input.xssoUserId);
  if (!user) {
    user = {
      id: nextId("user"),
      xssoUserId: input.xssoUserId,
      username: input.username,
      displayName: input.displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.users.push(user);
  } else {
    user.username = input.username;
    user.displayName = input.displayName;
    user.updatedAt = new Date().toISOString();
  }
  return user;
}

function findUserCollection(userId, id) {
  const collectionId = Number(id);
  return store.collections.find((item) => item.userId === userId && item.id === collectionId);
}

function withoutTree(collection) {
  const { tree, ...rest } = collection;
  return rest;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName
  };
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt
  };
}

function nextId(type) {
  const id = store.nextIds[type] ?? 1;
  store.nextIds[type] = id + 1;
  return id;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function stripBasePath(pathname) {
  if (pathname === config.basePath) return "/";
  if (pathname.startsWith(`${config.basePath}/`)) return pathname.slice(config.basePath.length);
  return null;
}

function withBasePath(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path === "/") return config.basePath;
  return `${config.basePath}${path}`;
}

function normalizeBasePath(value) {
  const path = `/${String(value ?? "").trim().replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? "" : path;
}

function safeRelativeRedirect(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return fallback;
  return text;
}

function safeDeviceCallbackUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "xsync:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function appendQuery(value, params) {
  const url = new URL(value);
  for (const [key, item] of Object.entries(params)) {
    url.searchParams.set(key, item);
  }
  return url.toString();
}

function normalizeSyncMode(value) {
  const mode = String(value ?? "merge");
  if (["merge", "local_over_server", "server_over_local"].includes(mode)) return mode;
  return "merge";
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function normalizeBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getBearerToken(req) {
  const authorization = req.headers.authorization ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie ?? "").split(/;\s*/);
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function buildCookie(name, value) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800"
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function randomToken(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
