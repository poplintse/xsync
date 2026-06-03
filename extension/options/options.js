const defaultConfig = {
  serverUrl: "https://xunit.cc/xsync-lite/",
  tokens: [],
  selectedTokenName: "",
  accountMode: "local",
  mode: "merge",
  selectedBookmarkId: ""
};

const els = {
  statusText: document.getElementById("statusText"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  accountModeInputs: [...document.querySelectorAll('input[name="accountMode"]')],
  localAccountPanel: document.getElementById("localAccountPanel"),
  localAccountSelect: document.getElementById("localAccountSelect"),
  useLocalAccountButton: document.getElementById("useLocalAccountButton"),
  startPairingButton: document.getElementById("startPairingButton"),
  pairingCodeBox: document.getElementById("pairingCodeBox"),
  newAccountPanel: document.getElementById("newAccountPanel"),
  newAccountNameInput: document.getElementById("newAccountNameInput"),
  newDeviceNameInput: document.getElementById("newDeviceNameInput"),
  createAccountButton: document.getElementById("createAccountButton"),
  pairAccountPanel: document.getElementById("pairAccountPanel"),
  pairingCodeInput: document.getElementById("pairingCodeInput"),
  pairDeviceNameInput: document.getElementById("pairDeviceNameInput"),
  finishPairingButton: document.getElementById("finishPairingButton"),
  modeInputs: [...document.querySelectorAll('input[name="mode"]')],
  reloadBookmarksButton: document.getElementById("reloadBookmarksButton"),
  bookmarkTree: document.getElementById("bookmarkTree"),
  syncButton: document.getElementById("syncButton"),
  resultBox: document.getElementById("resultBox")
};

let config = { ...defaultConfig };
let bookmarkRoots = [];
let bookmarkById = new Map();

init();

async function init() {
  config = { ...defaultConfig, ...(await chrome.storage.local.get(defaultConfig)) };
  bindConfig();
  renderLocalAccounts();
  await chrome.storage.local.set(config);
  await loadBookmarks();
  renderStatus();
}

function bindConfig() {
  els.serverUrlInput.value = config.serverUrl;
  const deviceName = defaultDeviceName();
  els.newDeviceNameInput.value = deviceName;
  els.pairDeviceNameInput.value = deviceName;
  renderAccountMode();
  renderMode();

  els.serverUrlInput.addEventListener("change", saveConfigFromForm);
  for (const input of els.accountModeInputs) input.addEventListener("change", changeAccountMode);
  for (const input of els.modeInputs) input.addEventListener("change", saveConfigFromForm);
  els.useLocalAccountButton.addEventListener("click", useLocalAccount);
  els.startPairingButton.addEventListener("click", startPairing);
  els.createAccountButton.addEventListener("click", createAccount);
  els.finishPairingButton.addEventListener("click", finishPairing);
  els.reloadBookmarksButton.addEventListener("click", loadBookmarks);
  els.syncButton.addEventListener("click", runSync);
}

function renderAccountMode() {
  for (const input of els.accountModeInputs) input.checked = input.value === config.accountMode;
  els.localAccountPanel.hidden = config.accountMode !== "local";
  els.newAccountPanel.hidden = config.accountMode !== "new";
  els.pairAccountPanel.hidden = config.accountMode !== "pair";
}

function renderMode() {
  for (const input of els.modeInputs) input.checked = input.value === config.mode;
}

async function changeAccountMode() {
  config.accountMode = selectedRadioValue(els.accountModeInputs, "local");
  await chrome.storage.local.set(config);
  renderAccountMode();
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

function renderLocalAccounts() {
  els.localAccountSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = config.tokens.length ? "请选择账户" : "本机暂无已授权账户";
  els.localAccountSelect.appendChild(placeholder);
  for (const item of config.tokens) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    els.localAccountSelect.appendChild(option);
  }
  if (config.tokens.some((item) => item.name === config.selectedTokenName)) {
    els.localAccountSelect.value = config.selectedTokenName;
  }
}

async function useLocalAccount() {
  const name = els.localAccountSelect.value;
  if (!name) return setResult("请选择本机已授权账户。", false);
  config.selectedTokenName = name;
  await chrome.storage.local.set(config);
  setResult(`已使用账户 "${name}"。`, true);
  renderStatus();
}

async function createAccount() {
  await saveConfigFromForm();
  const name = els.newAccountNameInput.value.trim();
  const deviceName = els.newDeviceNameInput.value.trim() || defaultDeviceName();
  if (!name) return setResult("请填写账户名称。", false);

  setBusy(true);
  try {
    const response = await publicPost("/api/accounts", { token_name: name, device_name: deviceName });
    saveLocalToken(response.account.tokenName, response.access_token);
    els.newAccountNameInput.value = "";
    config.accountMode = "local";
    renderLocalAccounts();
    renderAccountMode();
    setResult(`账户 "${response.account.tokenName}" 已创建，当前设备已授权。`, true);
  } catch (error) {
    setResult(`新建账户失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function startPairing() {
  await saveConfigFromForm();
  const token = currentToken();
  if (!token) return setResult("请先选择本机已授权账户。", false);

  setBusy(true);
  try {
    const response = await apiFetch("/api/pairing/start", {}, token);
    els.pairingCodeBox.textContent = `配对码：${formatPairingCode(response.code)}，5 分钟内有效，仅可使用一次。`;
    els.pairingCodeBox.hidden = false;
    setResult(`已为账户 "${response.account.tokenName}" 生成配对码。`, true);
  } catch (error) {
    setResult(`生成配对码失败：${error.message}`, false);
  } finally {
    setBusy(false);
  }
}

async function finishPairing() {
  await saveConfigFromForm();
  const code = els.pairingCodeInput.value.replace(/\s+/g, "");
  const deviceName = els.pairDeviceNameInput.value.trim() || defaultDeviceName();
  if (!/^\d{6}$/.test(code)) return setResult("请输入 6 位配对码。", false);

  setBusy(true);
  try {
    const response = await publicPost("/api/pairing/finish", { code, device_name: deviceName });
    saveLocalToken(response.account.tokenName, response.access_token);
    els.pairingCodeInput.value = "";
    config.accountMode = "local";
    renderLocalAccounts();
    renderAccountMode();
    setResult(`已配对账户 "${response.account.tokenName}"，当前设备已授权。`, true);
  } catch (error) {
    setResult(`配对失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

function saveLocalToken(name, token) {
  config.tokens = config.tokens.filter((item) => item.name !== name);
  config.tokens.push({ name, token });
  config.selectedTokenName = name;
  chrome.storage.local.set(config);
}

async function loadBookmarks() {
  setResult("正在读取 Chrome 书签...");
  bookmarkRoots = await chrome.bookmarks.getTree();
  bookmarkById = new Map();
  for (const root of bookmarkRoots) indexBookmarkNode(root, []);
  renderBookmarkTree();
  setResult("请选择一个本地书签目录或具体书签。");
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
  const token = currentToken();
  if (!token) return setResult("请先新建账户、配对账户或选择本机账户。", false);

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
  const options = { method, headers: { "Authorization": `Bearer ${token}` } };
  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  return parseResponse(await fetch(`${serverBaseUrl()}${path}`, options));
}

async function publicPost(path, body) {
  return parseResponse(await fetch(`${serverBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
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

function currentToken() {
  return config.tokens.find((item) => item.name === config.selectedTokenName)?.token ?? "";
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

function defaultDeviceName() {
  return `Chrome on ${navigator.platform || "device"}`;
}

function formatPairingCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : new Date().toLocaleString();
}

function renderStatus() {
  const parts = [];
  parts.push(config.selectedTokenName ? `账户 ${config.selectedTokenName}` : "未选择账户");
  const selected = bookmarkById.get(config.selectedBookmarkId);
  if (selected) parts.push(selected.path.join(" / "));
  els.statusText.textContent = parts.join(" · ");
}

function setBusy(isBusy) {
  els.useLocalAccountButton.disabled = isBusy;
  els.startPairingButton.disabled = isBusy;
  els.createAccountButton.disabled = isBusy;
  els.finishPairingButton.disabled = isBusy;
  els.syncButton.disabled = isBusy;
}

function setResult(message, ok) {
  els.resultBox.textContent = message;
  els.resultBox.className = `result-box${ok === true ? " success" : ok === false ? " error" : ""}`;
}
