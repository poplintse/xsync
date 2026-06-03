const defaultConfig = {
  serverUrl: "https://xunit.cc/xsync-lite/",
  tokens: [],
  selectedTokenName: "",
  tokenMode: "existing",
  mode: "merge",
  selectedBookmarkId: ""
};

const els = {
  statusText: document.getElementById("statusText"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  tokenModeInputs: [...document.querySelectorAll('input[name="tokenMode"]')],
  existingTokenPanel: document.getElementById("existingTokenPanel"),
  existingTokenNameSelect: document.getElementById("existingTokenNameSelect"),
  existingTokenValueInput: document.getElementById("existingTokenValueInput"),
  refreshTokenNamesButton: document.getElementById("refreshTokenNamesButton"),
  useExistingTokenButton: document.getElementById("useExistingTokenButton"),
  newTokenPanel: document.getElementById("newTokenPanel"),
  newTokenNameInput: document.getElementById("newTokenNameInput"),
  generateTokenButton: document.getElementById("generateTokenButton"),
  generatedTokenField: document.getElementById("generatedTokenField"),
  generatedTokenOutput: document.getElementById("generatedTokenOutput"),
  modeInputs: [...document.querySelectorAll('input[name="mode"]')],
  reloadBookmarksButton: document.getElementById("reloadBookmarksButton"),
  bookmarkTree: document.getElementById("bookmarkTree"),
  syncButton: document.getElementById("syncButton"),
  resultBox: document.getElementById("resultBox")
};

let config = { ...defaultConfig };
let bookmarkRoots = [];
let bookmarkById = new Map();
let remoteTokenNames = [];

init();

async function init() {
  config = { ...defaultConfig, ...(await chrome.storage.local.get(defaultConfig)) };
  bindConfig();
  await chrome.storage.local.set(config);
  await Promise.all([loadTokenNames(), loadBookmarks()]);
  renderStatus();
}

function bindConfig() {
  els.serverUrlInput.value = config.serverUrl;
  renderTokenMode();
  renderMode();

  els.serverUrlInput.addEventListener("change", async () => {
    await saveConfigFromForm();
    await loadTokenNames();
  });
  for (const input of els.tokenModeInputs) input.addEventListener("change", changeTokenMode);
  for (const input of els.modeInputs) input.addEventListener("change", saveConfigFromForm);
  els.refreshTokenNamesButton.addEventListener("click", loadTokenNames);
  els.useExistingTokenButton.addEventListener("click", useExistingToken);
  els.generateTokenButton.addEventListener("click", generateAndSaveToken);
  els.reloadBookmarksButton.addEventListener("click", loadBookmarks);
  els.syncButton.addEventListener("click", runSync);
}

function renderTokenMode() {
  for (const input of els.tokenModeInputs) input.checked = input.value === config.tokenMode;
  els.existingTokenPanel.hidden = config.tokenMode !== "existing";
  els.newTokenPanel.hidden = config.tokenMode !== "new";
}

function renderMode() {
  for (const input of els.modeInputs) input.checked = input.value === config.mode;
}

async function changeTokenMode() {
  config.tokenMode = selectedRadioValue(els.tokenModeInputs, "existing");
  await chrome.storage.local.set(config);
  renderTokenMode();
}

async function saveConfigFromForm() {
  config = {
    ...config,
    serverUrl: normalizeServerUrl(els.serverUrlInput.value),
    mode: selectedRadioValue(els.modeInputs, "merge")
  };
  els.serverUrlInput.value = config.serverUrl;
  await chrome.storage.local.set(config);
  renderStatus();
}

async function loadTokenNames() {
  await saveConfigFromForm();
  try {
    const response = await publicFetch("/api/token-names");
    remoteTokenNames = response.token_names ?? [];
    renderTokenNames();
  } catch (error) {
    remoteTokenNames = [];
    renderTokenNames();
    setResult(`读取 Token 名称失败：${error.message}`, false);
  }
}

function renderTokenNames() {
  els.existingTokenNameSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = remoteTokenNames.length ? "请选择 Token 名称" : "服务器上暂无 Token";
  els.existingTokenNameSelect.appendChild(placeholder);

  for (const name of remoteTokenNames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.existingTokenNameSelect.appendChild(option);
  }
  if (remoteTokenNames.includes(config.selectedTokenName)) els.existingTokenNameSelect.value = config.selectedTokenName;
}

async function useExistingToken() {
  await saveConfigFromForm();
  const name = els.existingTokenNameSelect.value;
  const token = els.existingTokenValueInput.value.trim() || localToken(name);
  if (!name) return setResult("请选择服务器上已有的 Token 名称。", false);
  if (!token) return setResult("请输入该名称对应的 Token。", false);

  setBusy(true);
  try {
    const response = await apiFetch("/api/account", null, token, "GET");
    if (response.account.tokenName !== name) throw new Error("token_name_mismatch");
    saveLocalToken(name, token);
    els.existingTokenValueInput.value = "";
    setResult(`已使用 Token "${name}"。`, true);
  } catch (error) {
    setResult(`使用已有 Token 失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function generateAndSaveToken() {
  await saveConfigFromForm();
  const name = els.newTokenNameInput.value.trim();
  if (!name) return setResult("请填写 Token 名称。", false);
  const token = randomToken();

  setBusy(true);
  try {
    const response = await apiFetch("/api/account/token-name", { token_name: name }, token);
    saveLocalToken(response.account.tokenName, token);
    els.generatedTokenOutput.value = token;
    els.generatedTokenField.hidden = false;
    els.newTokenNameInput.value = "";
    await loadTokenNames();
    setResult(`新 Token "${name}" 已保存并设为当前 Token。请妥善保存显示的 Token。`, true);
  } catch (error) {
    setResult(`生成 Token 失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

function saveLocalToken(name, token) {
  config.tokens = config.tokens.filter((item) => item.name !== name && item.token !== token);
  config.tokens.push({ name, token });
  config.selectedTokenName = name;
  chrome.storage.local.set(config);
}

async function loadBookmarks() {
  setResult("正在读取 Chrome 书签...", true);
  bookmarkRoots = await chrome.bookmarks.getTree();
  bookmarkById = new Map();
  for (const root of bookmarkRoots) indexBookmarkNode(root, []);
  renderBookmarkTree();
  setResult("请选择一个本地书签目录或具体书签。", true);
}

function indexBookmarkNode(node, parentPath) {
  const label = bookmarkLabel(node);
  const path = label ? [...parentPath, label] : parentPath;
  bookmarkById.set(node.id, { node, path });
  for (const child of node.children ?? []) indexBookmarkNode(child, path);
}

function renderBookmarkTree() {
  els.bookmarkTree.textContent = "";
  const list = document.createElement("ul");
  for (const root of bookmarkRoots) appendBookmarkNode(list, root, false);
  els.bookmarkTree.appendChild(list);
}

function appendBookmarkNode(parent, node, inheritedSelection) {
  const selected = node.id === config.selectedBookmarkId;
  const included = inheritedSelection || selected;
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = `tree-option${selected ? " selected" : ""}${inheritedSelection ? " inherited" : ""}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = included;
  checkbox.disabled = inheritedSelection;
  checkbox.addEventListener("change", () => selectBookmarkNode(node.id));

  const text = document.createElement("span");
  text.textContent = bookmarkLabel(node);
  label.append(checkbox, text);
  item.appendChild(label);

  if (node.children?.length) {
    const children = document.createElement("ul");
    for (const child of node.children) appendBookmarkNode(children, child, included);
    item.appendChild(children);
  }
  parent.appendChild(item);
}

async function selectBookmarkNode(id) {
  config.selectedBookmarkId = config.selectedBookmarkId === id ? "" : id;
  await chrome.storage.local.set(config);
  renderBookmarkTree();
  renderStatus();
}

function bookmarkLabel(node) {
  if (node.title) return node.title;
  if (node.id === "0") return "Chrome 书签";
  return node.url || "未命名书签";
}

async function runSync() {
  await saveConfigFromForm();
  if (!config.selectedBookmarkId) return setResult("请先选择一个本地书签目录或具体书签。", false);
  const token = localToken(config.selectedTokenName);
  if (!token) return setResult("请先使用已有 Token 或生成新 Token。", false);

  setBusy(true);
  try {
    const [node] = await chrome.bookmarks.getSubTree(config.selectedBookmarkId);
    const localTree = normalizeBookmarkNode(node);
    const collectionName = bookmarkById.get(config.selectedBookmarkId)?.path.join(" / ") || bookmarkLabel(node);
    const result = await apiFetch("/api/sync/apply", {
      mode: config.mode,
      collection_name: collectionName,
      local_tree: localTree
    }, token);
    if (config.mode === "server_over_local" && result.tree) await replaceSelectedNode(node, result.tree);
    setResult(`同步成功\n远端集合：${result.collection.name}\n同步时间：${formatTime(result.collection.updatedAt)}`, true);
  } catch (error) {
    setResult(`同步失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function apiFetch(path, body, token, method = "POST") {
  const options = {
    method,
    headers: { "Authorization": `Bearer ${token}` }
  };
  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${serverBaseUrl()}${path}`, options);
  return parseResponse(response);
}

async function publicFetch(path) {
  const response = await fetch(`${serverBaseUrl()}${path}`);
  return parseResponse(response);
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function replaceSelectedNode(selected, remoteTree) {
  if (selected.url) {
    await chrome.bookmarks.update(selected.id, { title: remoteTree.title || "", url: remoteTree.url || selected.url });
    return;
  }
  for (const child of selected.children || []) await chrome.bookmarks.removeTree(child.id);
  for (const child of remoteTree.children || []) await createBookmarkNode(selected.id, child);
}

async function createBookmarkNode(parentId, node) {
  const created = await chrome.bookmarks.create({
    parentId,
    title: node.title || "",
    url: node.type === "bookmark" ? node.url : undefined
  });
  if (node.type !== "bookmark") {
    for (const child of node.children || []) await createBookmarkNode(created.id, child);
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

function localToken(name) {
  return config.tokens.find((item) => item.name === name)?.token ?? "";
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selectedRadioValue(inputs, fallback) {
  return inputs.find((input) => input.checked)?.value ?? fallback;
}

function normalizeServerUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

function serverBaseUrl() {
  return config.serverUrl.replace(/\/+$/, "");
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : new Date().toLocaleString();
}

function renderStatus() {
  const parts = [];
  parts.push(config.selectedTokenName ? `Token ${config.selectedTokenName}` : "未选择 Token");
  const selected = bookmarkById.get(config.selectedBookmarkId);
  if (selected) parts.push(selected.path.join(" / "));
  els.statusText.textContent = parts.join(" · ");
}

function setBusy(isBusy) {
  els.refreshTokenNamesButton.disabled = isBusy;
  els.useExistingTokenButton.disabled = isBusy;
  els.generateTokenButton.disabled = isBusy;
  els.syncButton.disabled = isBusy;
}

function setResult(message, ok) {
  els.resultBox.textContent = message;
  els.resultBox.className = `result-box${ok === true ? " success" : ok === false ? " error" : ""}`;
}
