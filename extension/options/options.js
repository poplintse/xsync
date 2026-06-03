const defaultConfig = {
  serverUrl: "https://xunit.cc/xsync-lite/",
  tokens: [],
  selectedTokenName: "",
  accessToken: "",
  collectionId: "",
  collectionName: "",
  mode: "merge",
  selectedBookmarkId: ""
};

const els = {
  statusText: document.getElementById("statusText"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  tokenSelect: document.getElementById("tokenSelect"),
  tokenNameInput: document.getElementById("tokenNameInput"),
  tokenValueInput: document.getElementById("tokenValueInput"),
  generateTokenButton: document.getElementById("generateTokenButton"),
  saveTokenButton: document.getElementById("saveTokenButton"),
  collectionIdInput: document.getElementById("collectionIdInput"),
  collectionNameInput: document.getElementById("collectionNameInput"),
  modeInputs: [...document.querySelectorAll('input[name="mode"]')],
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
  migrateLegacyToken();
  bindConfig();
  await chrome.storage.local.set(config);
  await loadBookmarks();
  renderStatus();
}

function migrateLegacyToken() {
  if (!config.tokens.length && config.accessToken) {
    config.tokens = [{ name: "default", token: config.accessToken }];
    config.selectedTokenName = "default";
  }
  delete config.accessToken;
}

function bindConfig() {
  els.serverUrlInput.value = config.serverUrl;
  els.collectionIdInput.value = config.collectionId;
  els.collectionNameInput.value = config.collectionName;
  renderTokenOptions();
  renderMode();

  for (const input of [els.serverUrlInput, els.collectionIdInput, els.collectionNameInput, ...els.modeInputs]) {
    input.addEventListener("change", saveConfigFromForm);
  }

  els.tokenSelect.addEventListener("change", selectToken);
  els.generateTokenButton.addEventListener("click", generateToken);
  els.saveTokenButton.addEventListener("click", saveToken);
  els.reloadBookmarksButton.addEventListener("click", loadBookmarks);
  els.previewButton.addEventListener("click", () => runSync("preview"));
  els.syncButton.addEventListener("click", () => runSync("apply"));
}

function renderTokenOptions() {
  els.tokenSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "请选择 Token";
  els.tokenSelect.appendChild(placeholder);

  for (const item of config.tokens) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    els.tokenSelect.appendChild(option);
  }

  els.tokenSelect.value = config.selectedTokenName;
}

function renderMode() {
  for (const input of els.modeInputs) input.checked = input.value === config.mode;
}

async function saveConfigFromForm() {
  config = {
    ...config,
    serverUrl: normalizeServerUrl(els.serverUrlInput.value),
    collectionId: els.collectionIdInput.value.trim(),
    collectionName: els.collectionNameInput.value.trim(),
    mode: selectedMode()
  };
  els.serverUrlInput.value = config.serverUrl;
  await chrome.storage.local.set(config);
  renderStatus();
}

async function selectToken() {
  config.selectedTokenName = els.tokenSelect.value;
  config.collectionId = "";
  els.collectionIdInput.value = "";
  await chrome.storage.local.set(config);
  renderStatus();
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  els.tokenValueInput.value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  setResult("已生成新的随机 Token，请填写名称后保存。");
}

async function saveToken() {
  await saveConfigFromForm();
  const name = els.tokenNameInput.value.trim();
  const token = els.tokenValueInput.value.trim();
  if (!name) return setResult("请填写 Token 名称。");
  if (!token) return setResult("请生成或填写 Token。");

  setBusy(true);
  try {
    const response = await apiFetch("/api/account/token-name", { token_name: name }, token);
    config.tokens = config.tokens.filter((item) => item.name !== name && item.token !== token);
    config.tokens.push({ name, token });
    config.selectedTokenName = name;
    config.collectionId = "";
    els.collectionIdInput.value = "";
    els.tokenNameInput.value = "";
    els.tokenValueInput.value = "";
    renderTokenOptions();
    await chrome.storage.local.set(config);
    setResult(`Token "${response.account.tokenName}" 已保存并选中。`);
  } catch (error) {
    setResult(`保存 Token 失败：${error.message}`);
  } finally {
    setBusy(false);
    renderStatus();
  }
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
  const token = selectedToken();
  if (!token) return setResult("请先选择一个 Token。");

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
    const result = await apiFetch(endpoint, body, token);
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

async function apiFetch(path, body, token) {
  const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
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

function selectedToken() {
  return config.tokens.find((item) => item.name === config.selectedTokenName)?.token ?? "";
}

function selectedMode() {
  return els.modeInputs.find((input) => input.checked)?.value ?? "merge";
}

function normalizeServerUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

function renderStatus() {
  const parts = [];
  parts.push(config.selectedTokenName ? `Token ${config.selectedTokenName}` : "未选择 Token");
  if (config.selectedBookmarkId) parts.push(`已选目录 ${config.selectedBookmarkId}`);
  if (config.collectionId) parts.push(`集合 ${config.collectionId}`);
  els.statusText.textContent = parts.join(" · ");
}

function setBusy(isBusy) {
  els.generateTokenButton.disabled = isBusy;
  els.saveTokenButton.disabled = isBusy;
  els.previewButton.disabled = isBusy;
  els.syncButton.disabled = isBusy;
}

function setResult(message) {
  els.resultBox.textContent = message;
}
