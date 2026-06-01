const defaultConfig = {
  serverUrl: "https://xunit.cc/xsync",
  accessToken: "",
  refreshToken: "",
  deviceCode: "",
  collectionId: "",
  collectionName: "",
  mode: "merge",
  selectedBookmarkId: ""
};

const els = {
  statusText: document.getElementById("statusText"),
  authorizeButton: document.getElementById("authorizeButton"),
  nativeTokenButton: document.getElementById("nativeTokenButton"),
  finishAuthorizationButton: document.getElementById("finishAuthorizationButton"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  accessTokenInput: document.getElementById("accessTokenInput"),
  deviceCodeInput: document.getElementById("deviceCodeInput"),
  collectionIdInput: document.getElementById("collectionIdInput"),
  collectionNameInput: document.getElementById("collectionNameInput"),
  modeSelect: document.getElementById("modeSelect"),
  reloadBookmarksButton: document.getElementById("reloadBookmarksButton"),
  bookmarkTree: document.getElementById("bookmarkTree"),
  previewButton: document.getElementById("previewButton"),
  syncButton: document.getElementById("syncButton"),
  resultBox: document.getElementById("resultBox")
};

let config = { ...defaultConfig };
let bookmarkRoots = [];

init();

async function init() {
  config = { ...defaultConfig, ...(await chrome.storage.local.get(defaultConfig)) };
  bindConfig();
  await loadBookmarks();
  renderStatus();
}

function bindConfig() {
  els.serverUrlInput.value = config.serverUrl;
  els.accessTokenInput.value = config.accessToken;
  els.deviceCodeInput.value = config.deviceCode;
  els.collectionIdInput.value = config.collectionId;
  els.collectionNameInput.value = config.collectionName;
  els.modeSelect.value = config.mode;

  for (const input of [els.serverUrlInput, els.accessTokenInput, els.deviceCodeInput, els.collectionIdInput, els.collectionNameInput, els.modeSelect]) {
    input.addEventListener("change", saveConfigFromForm);
  }

  els.reloadBookmarksButton.addEventListener("click", loadBookmarks);
  els.previewButton.addEventListener("click", () => runSync("preview"));
  els.syncButton.addEventListener("click", () => runSync("apply"));
  els.authorizeButton.addEventListener("click", openAuthorizationPage);
  els.nativeTokenButton.addEventListener("click", refreshTokenFromNativeHost);
  els.finishAuthorizationButton.addEventListener("click", finishAuthorizationWithCode);
}

async function saveConfigFromForm() {
  config = {
    ...config,
    serverUrl: els.serverUrlInput.value.trim().replace(/\/+$/, ""),
    accessToken: els.accessTokenInput.value.trim(),
    deviceCode: els.deviceCodeInput.value.trim(),
    collectionId: els.collectionIdInput.value.trim(),
    collectionName: els.collectionNameInput.value.trim(),
    mode: els.modeSelect.value
  };
  await chrome.storage.local.set(config);
  renderStatus();
}

async function loadBookmarks() {
  setResult("正在读取 Chrome 书签...");
  bookmarkRoots = await chrome.bookmarks.getTree();
  renderBookmarkTree();
  setResult("请选择一个书签目录。");
}

function renderBookmarkTree() {
  els.bookmarkTree.textContent = "";
  const list = document.createElement("ul");
  for (const root of bookmarkRoots) {
    appendBookmarkNode(list, root);
  }
  els.bookmarkTree.appendChild(list);
}

function appendBookmarkNode(parent, node) {
  if (!node.children) return;
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = folderLabel(node);
  button.className = node.id === config.selectedBookmarkId ? "selected" : "";
  button.addEventListener("click", async () => {
    config.selectedBookmarkId = node.id;
    if (!config.collectionName && node.title) {
      config.collectionName = node.title;
      els.collectionNameInput.value = node.title;
    }
    await chrome.storage.local.set(config);
    renderBookmarkTree();
    renderStatus();
  });
  item.appendChild(button);

  const children = document.createElement("ul");
  for (const child of node.children) appendBookmarkNode(children, child);
  if (children.childNodes.length) item.appendChild(children);
  parent.appendChild(item);
}

function folderLabel(node) {
  if (node.title) return node.title;
  if (node.id === "0") return "Chrome 书签";
  return "未命名目录";
}

async function runSync(action) {
  await saveConfigFromForm();
  if (!config.selectedBookmarkId) return setResult("请先选择一个本地书签目录。");
  const accessToken = await resolveAccessToken();
  if (!accessToken) return setResult("请先完成设备授权，或临时粘贴 Access Token。");

  setBusy(true);
  try {
    const [node] = await chrome.bookmarks.getSubTree(config.selectedBookmarkId);
    const localTree = normalizeBookmarkNode(node);
    const body = {
      mode: config.mode,
      collection_id: config.collectionId ? Number(config.collectionId) : undefined,
      collection_name: config.collectionName || localTree.title,
      local_tree: localTree
    };
    const endpoint = action === "preview" ? "/api/sync/preview" : "/api/sync/apply";
    const result = await apiFetch(endpoint, body, accessToken);
    if (action === "apply" && config.mode === "server_over_local" && result.tree) {
      await replaceSelectedFolder(result.tree);
    }
    if (result.collection?.id && !config.collectionId) {
      config.collectionId = String(result.collection.id);
      els.collectionIdInput.value = config.collectionId;
      await chrome.storage.local.set(config);
    }
    setResult(JSON.stringify(result, null, 2));
  } catch (error) {
    setResult(`同步失败：${error.message}`);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function apiFetch(path, body, accessToken) {
  const response = await fetch(`${config.serverUrl}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function finishAuthorizationWithCode() {
  await saveConfigFromForm();
  if (!config.deviceCode) return setResult("请先填写一次性授权码。");

  setBusy(true);
  try {
    const response = await fetch(`${config.serverUrl}/api/device/authorize/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: config.deviceCode })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    config.accessToken = data.access_token || "";
    config.refreshToken = data.refresh_token || "";
    config.deviceCode = "";
    els.accessTokenInput.value = config.accessToken;
    els.deviceCodeInput.value = "";
    await chrome.storage.local.set(config);
    setResult("授权完成，token 已保存到扩展本地配置。托盘 App 接入后会改由系统钥匙串保存。");
  } catch (error) {
    setResult(`授权失败：${error.message}`);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function replaceSelectedFolder(remoteTree) {
  const [selected] = await chrome.bookmarks.getSubTree(config.selectedBookmarkId);
  for (const child of selected.children || []) {
    await chrome.bookmarks.removeTree(child.id);
  }
  for (const child of remoteTree.children || []) {
    await createBookmarkNode(config.selectedBookmarkId, child);
  }
}

async function createBookmarkNode(parentId, node) {
  const created = await chrome.bookmarks.create({
    parentId,
    title: node.title || "",
    url: node.type === "bookmark" ? node.url : undefined
  });
  if (node.type !== "bookmark") {
    for (const child of node.children || []) {
      await createBookmarkNode(created.id, child);
    }
  }
  return created;
}

function normalizeBookmarkNode(node) {
  return {
    stableId: stableIdFor(node),
    chromeId: node.id,
    type: node.url ? "bookmark" : "folder",
    title: node.title || "",
    url: node.url || null,
    children: (node.children || []).map(normalizeBookmarkNode)
  };
}

function stableIdFor(node) {
  const source = `${node.title || ""}|${node.url || ""}|${node.id}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return `chrome-${Math.abs(hash)}`;
}

async function openAuthorizationPage() {
  const serverUrl = els.serverUrlInput.value.trim().replace(/\/+$/, "");
  try {
    const response = await requestNativeMessage({
      type: "startAuthorization",
      serverUrl,
      deviceName: "Chrome Extension",
      platform: "chrome"
    });
    if (response.ok) {
      setResult("已交给托盘 App 处理设备授权。");
      return;
    }
  } catch {
    // Browser fallback keeps first-run development usable without the tray app.
  }
  const url = `${serverUrl}/device/authorize?device_name=${encodeURIComponent("Chrome Extension")}&platform=chrome`;
  chrome.tabs.create({ url });
}

async function refreshTokenFromNativeHost() {
  setBusy(true);
  try {
    const accessToken = await requestNativeAccessToken();
    config.accessToken = accessToken;
    els.accessTokenInput.value = accessToken;
    await chrome.storage.local.set(config);
    setResult("已从托盘 App 获取 token。");
  } catch (error) {
    setResult(`托盘 App 暂不可用：${error.message}`);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function resolveAccessToken() {
  try {
    const accessToken = await requestNativeAccessToken();
    if (accessToken) return accessToken;
  } catch {
    // Manual token is the development fallback until the tray app is installed.
  }
  return config.accessToken;
}

function requestNativeAccessToken() {
  return requestNativeMessage({ type: "getAccessToken", serverUrl: config.serverUrl }).then((response) => {
    if (!response.ok) throw new Error(response.error || "native_host_error");
    if (!response.accessToken) throw new Error("missing_access_token");
    return response.accessToken;
  });
}

function requestNativeMessage(message) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative("com.xunit.xsync");
    } catch (error) {
      reject(error);
      return;
    }

    port.onMessage.addListener((response) => {
      resolve(response);
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
    });
    port.postMessage(message);
  });
}

function renderStatus() {
  const parts = [];
  parts.push(config.accessToken ? "已配置 token" : "未授权");
  if (config.selectedBookmarkId) parts.push(`已选目录 ${config.selectedBookmarkId}`);
  if (config.collectionId) parts.push(`集合 ${config.collectionId}`);
  els.statusText.textContent = parts.join(" · ");
}

function setBusy(isBusy) {
  els.previewButton.disabled = isBusy;
  els.syncButton.disabled = isBusy;
}

function setResult(message) {
  els.resultBox.textContent = message;
}
