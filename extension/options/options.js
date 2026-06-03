const defaultConfig = {
  serverUrl: "https://xunit.cc/xsync-lite/",
  tokens: [],
  selectedTokenName: "",
  accountMode: "local",
  operation: "backup",
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
  operationInputs: [...document.querySelectorAll('input[name="operation"]')],
  restorePanel: document.getElementById("restorePanel"),
  backupSelect: document.getElementById("backupSelect"),
  refreshBackupsButton: document.getElementById("refreshBackupsButton"),
  bookmarkPanel: document.getElementById("bookmarkPanel"),
  reloadBookmarksButton: document.getElementById("reloadBookmarksButton"),
  bookmarkTree: document.getElementById("bookmarkTree"),
  actionButton: document.getElementById("actionButton"),
  resultBox: document.getElementById("resultBox")
};

let config = { ...defaultConfig };
let bookmarkRoots = [];
let bookmarkById = new Map();
let expandedBookmarkIds = new Set();
let backups = [];

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
  renderOperation();

  els.serverUrlInput.addEventListener("change", saveConfigFromForm);
  for (const input of els.accountModeInputs) input.addEventListener("change", changeAccountMode);
  for (const input of els.operationInputs) input.addEventListener("change", changeOperation);
  els.useLocalAccountButton.addEventListener("click", useLocalAccount);
  els.startPairingButton.addEventListener("click", startPairing);
  els.createAccountButton.addEventListener("click", createAccount);
  els.finishPairingButton.addEventListener("click", finishPairing);
  els.refreshBackupsButton.addEventListener("click", loadBackups);
  els.reloadBookmarksButton.addEventListener("click", loadBookmarks);
  els.actionButton.addEventListener("click", runAction);
}

function renderAccountMode() {
  for (const input of els.accountModeInputs) input.checked = input.value === config.accountMode;
  els.localAccountPanel.hidden = config.accountMode !== "local";
  els.newAccountPanel.hidden = config.accountMode !== "new";
  els.pairAccountPanel.hidden = config.accountMode !== "pair";
}

function renderOperation() {
  for (const input of els.operationInputs) input.checked = input.value === config.operation;
  const restoring = config.operation === "restore";
  els.restorePanel.hidden = !restoring;
  els.bookmarkPanel.hidden = restoring;
  els.actionButton.textContent = restoring ? "立即恢复" : "立即备份";
}

async function changeAccountMode() {
  config.accountMode = selectedRadioValue(els.accountModeInputs, "local");
  await chrome.storage.local.set(config);
  renderAccountMode();
}

async function saveConfigFromForm() {
  config = {
    ...config,
    serverUrl: normalizeServerUrl(els.serverUrlInput.value)
  };
  els.serverUrlInput.value = config.serverUrl;
  await chrome.storage.local.set(config);
  renderStatus();
}

async function changeOperation() {
  config.operation = selectedRadioValue(els.operationInputs, "backup");
  await chrome.storage.local.set(config);
  renderOperation();
  if (config.operation === "restore") await loadBackups();
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
  if (config.operation === "restore") await loadBackups();
}

async function createAccount() {
  await saveConfigFromForm();
  const name = els.newAccountNameInput.value.trim();
  const deviceName = els.newDeviceNameInput.value.trim() || defaultDeviceName();
  if (!name) return setResult("请填写账户名称。", false);

  setBusy(true);
  try {
    const response = await publicPost("/api/accounts", { token_name: name, device_name: deviceName });
    saveLocalToken(response.account.tokenName, response.access_token, response.device.name);
    els.newAccountNameInput.value = "";
    config.accountMode = "local";
    renderLocalAccounts();
    renderAccountMode();
    setResult(`账户 "${response.account.tokenName}" 已创建，当前设备已授权。`, true);
    if (config.operation === "restore") await loadBackups();
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
    saveLocalToken(response.account.tokenName, response.access_token, response.device.name);
    els.pairingCodeInput.value = "";
    config.accountMode = "local";
    renderLocalAccounts();
    renderAccountMode();
    setResult(`已配对账户 "${response.account.tokenName}"，当前设备已授权。`, true);
    if (config.operation === "restore") await loadBackups();
  } catch (error) {
    setResult(`配对失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

function saveLocalToken(name, token, deviceName) {
  config.tokens = config.tokens.filter((item) => item.name !== name);
  config.tokens.push({ name, token, deviceName });
  config.selectedTokenName = name;
  chrome.storage.local.set(config);
}

async function loadBackups() {
  const token = currentToken();
  if (!token) {
    backups = [];
    renderBackups();
    return setResult("请先新建账户、配对账户或选择本机账户。", false);
  }
  setBusy(true);
  try {
    const response = await apiFetch("/api/backups", null, token, "GET");
    backups = response.backups ?? [];
    renderBackups();
    setResult(backups.length ? "请选择要恢复的服务器备份。" : "服务器上暂无可用备份。");
  } catch (error) {
    backups = [];
    renderBackups();
    setResult(`读取备份列表失败：${error.message}`, false);
  } finally {
    setBusy(false);
  }
}

function renderBackups() {
  els.backupSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = backups.length ? "请选择备份" : "暂无备份";
  els.backupSelect.appendChild(placeholder);
  for (const backup of backups) {
    const option = document.createElement("option");
    option.value = String(backup.id);
    option.textContent = backup.name;
    els.backupSelect.appendChild(option);
  }
}

async function loadBookmarks() {
  setResult("正在读取 Chrome 书签...");
  bookmarkRoots = await chrome.bookmarks.getTree();
  bookmarkById = new Map();
  for (const root of bookmarkRoots) indexBookmarkNode(root, [], null);
  if (bookmarkById.get(config.selectedBookmarkId)?.node.url) {
    config.selectedBookmarkId = "";
    await chrome.storage.local.set(config);
  }
  expandedBookmarkIds = new Set(bookmarkRoots.map((root) => root.id));
  expandSelectedBookmarkAncestors();
  renderBookmarkTree();
  setResult("请选择一个本地收藏夹目录。");
}

function indexBookmarkNode(node, parentPath, parentId) {
  const label = bookmarkLabel(node);
  const path = label ? [...parentPath, label] : parentPath;
  bookmarkById.set(node.id, { node, path, parentId });
  for (const child of node.children ?? []) indexBookmarkNode(child, path, node.id);
}

function expandSelectedBookmarkAncestors() {
  let entry = bookmarkById.get(config.selectedBookmarkId);
  while (entry?.parentId) {
    expandedBookmarkIds.add(entry.parentId);
    entry = bookmarkById.get(entry.parentId);
  }
}

function renderBookmarkTree() {
  els.bookmarkTree.textContent = "";
  const list = document.createElement("ul");
  for (const root of bookmarkRoots) appendBookmarkNode(list, root, false);
  els.bookmarkTree.appendChild(list);
}

function appendBookmarkNode(parent, node, inheritedSelection) {
  const isFolder = !node.url;
  const selected = node.id === config.selectedBookmarkId;
  const included = inheritedSelection || selected;
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = `tree-option${selected ? " selected" : ""}${inheritedSelection ? " inherited" : ""}`;
  const hasChildren = Boolean(node.children?.length);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = hasChildren ? (expandedBookmarkIds.has(node.id) ? "▾" : "▸") : "";
  toggle.disabled = !hasChildren;
  toggle.setAttribute("aria-label", hasChildren ? `${expandedBookmarkIds.has(node.id) ? "收起" : "展开"} ${bookmarkLabel(node)}` : "");
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleBookmarkNode(node.id);
  });
  const text = document.createElement("span");
  text.textContent = bookmarkLabel(node);
  label.append(toggle);
  if (isFolder) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = included;
    checkbox.disabled = inheritedSelection;
    checkbox.addEventListener("change", () => selectBookmarkNode(node.id));
    label.append(checkbox);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "tree-checkbox-spacer";
    label.append(spacer);
  }
  label.append(text);
  item.appendChild(label);

  if (hasChildren && expandedBookmarkIds.has(node.id)) {
    const children = document.createElement("ul");
    for (const child of node.children) appendBookmarkNode(children, child, included);
    item.appendChild(children);
  }
  parent.appendChild(item);
}

function toggleBookmarkNode(id) {
  if (expandedBookmarkIds.has(id)) expandedBookmarkIds.delete(id);
  else expandedBookmarkIds.add(id);
  renderBookmarkTree();
}

async function selectBookmarkNode(id) {
  if (bookmarkById.get(id)?.node.url) return;
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

async function runAction() {
  await saveConfigFromForm();
  const token = currentToken();
  if (!token) return setResult("请先新建账户、配对账户或选择本机账户。", false);
  if (config.operation === "restore") return restoreBackup(token);
  return createBackup(token);
}

async function createBackup(token) {
  if (!config.selectedBookmarkId) return setResult("请先选择一个本地收藏夹目录。", false);
  if (bookmarkById.get(config.selectedBookmarkId)?.node.url) return setResult("备份只能选择收藏夹目录。", false);
  setBusy(true);
  try {
    const [node] = await chrome.bookmarks.getSubTree(config.selectedBookmarkId);
    const bookmarkPathParts = bookmarkById.get(config.selectedBookmarkId)?.path ?? [bookmarkLabel(node)];
    const bookmarkPath = bookmarkPathParts.join(" / ");
    const result = await apiFetch("/api/backups", {
      device_name: currentDeviceName(),
      bookmark_path: bookmarkPath,
      bookmark_path_parts: bookmarkPathParts,
      tree: normalizeBookmarkNode(node)
    }, token);
    setResult(`备份成功\n备份名称：${result.backup.name}\n备份时间：${formatTime(result.backup.createdAt)}`, true);
  } catch (error) {
    setResult(`备份失败：${error.message}`, false);
  } finally {
    setBusy(false);
    renderStatus();
  }
}

async function restoreBackup(token) {
  const backupId = els.backupSelect.value;
  if (!backupId) return setResult("请选择要恢复的服务器备份。", false);
  setBusy(true);
  try {
    const result = await apiFetch(`/api/backups/${backupId}`, null, token, "GET");
    await loadBookmarks();
    await mergeBackupIntoPath(result.backup.bookmarkPathParts ?? result.backup.bookmarkPath.split(" / "), result.tree);
    await loadBookmarks();
    setResult(`恢复成功\n备份名称：${result.backup.name}\n恢复路径：${result.backup.bookmarkPath}\n恢复方式：合并本地与备份内容`, true);
  } catch (error) {
    setResult(`恢复失败：${error.message}`, false);
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

async function mergeBackupIntoPath(pathParts, backupTree) {
  const roots = await chrome.bookmarks.getTree();
  let current = roots[0];
  const parts = [...pathParts];
  if (parts[0] === bookmarkLabel(current)) parts.shift();

  for (const part of parts.slice(0, -1)) {
    current = await findOrCreateFolder(current, part);
  }

  const targetName = parts.at(-1) || backupTree.title || "恢复的书签";
  const target = findMatchingChild(current, backupTree, targetName);
  if (target) {
    await mergeBookmarkNode(target, backupTree);
    return;
  }
  await createBookmarkNode(current.id, { ...backupTree, title: targetName });
}

async function findOrCreateFolder(parent, title) {
  const existing = (parent.children ?? []).find((child) => !child.url && child.title === title);
  if (existing) return existing;
  const created = await chrome.bookmarks.create({ parentId: parent.id, title });
  return { ...created, children: [] };
}

function findMatchingChild(parent, node, title = node.title || "") {
  return (parent.children ?? []).find((child) => {
    if (node.type === "bookmark" || node.url) return child.url === node.url && child.title === title;
    return !child.url && child.title === title;
  });
}

async function mergeBookmarkNode(localNode, backupNode) {
  if (backupNode.type === "bookmark" || backupNode.url) return;
  const [freshLocal] = await chrome.bookmarks.getSubTree(localNode.id);
  for (const backupChild of backupNode.children ?? []) {
    const matching = findMatchingChild(freshLocal, backupChild);
    if (matching) await mergeBookmarkNode(matching, backupChild);
    else await createBookmarkNode(localNode.id, backupChild);
  }
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

function currentDeviceName() {
  return config.tokens.find((item) => item.name === config.selectedTokenName)?.deviceName || defaultDeviceName();
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
  els.refreshBackupsButton.disabled = isBusy;
  els.actionButton.disabled = isBusy;
}

function setResult(message, ok) {
  els.resultBox.textContent = message;
  els.resultBox.className = `result-box${ok === true ? " success" : ok === false ? " error" : ""}`;
}
