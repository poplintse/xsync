import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("api token mode pairs devices into the same account", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "xsync-test-"));
  const server = await startServer(dataDir, "api_token");
  const baseUrl = server.baseUrl;

  try {
    const home = await fetchText(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(home.body, /xsync lite/);

    const deviceAuthorization = await fetchJson(`${baseUrl}/api/device/authorize/start`, {
      method: "POST"
    });
    assert.equal(deviceAuthorization.status, 404);

    const invalidAccount = await fetchJson(`${baseUrl}/api/account`, {
      headers: { "Authorization": "Bearer random-unissued-token" }
    });
    assert.equal(invalidAccount.status, 401);

    const createAccount = await fetchJson(`${baseUrl}/api/accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token_name: "Personal Bookmarks", device_name: "Home Chrome" })
    });
    assert.equal(createAccount.status, 201);
    assert.equal(createAccount.body.account.tokenName, "Personal Bookmarks");
    assert.equal(createAccount.body.device.name, "Home Chrome");
    const firstDeviceToken = createAccount.body.access_token;

    const duplicateAccount = await fetchJson(`${baseUrl}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_name: "Personal Bookmarks" })
    });
    assert.equal(duplicateAccount.status, 409);

    const account = await fetchJson(`${baseUrl}/api/account`, {
      headers: { "Authorization": `Bearer ${firstDeviceToken}` }
    });
    assert.equal(account.status, 200);
    assert.equal(account.body.account.tokenName, "Personal Bookmarks");

    const pairing = await fetchJson(`${baseUrl}/api/pairing/start`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firstDeviceToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(pairing.status, 201);
    assert.match(pairing.body.code, /^\d{6}$/);

    const finishPairing = await fetchJson(`${baseUrl}/api/pairing/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.body.code, device_name: "Office Chrome" })
    });
    assert.equal(finishPairing.status, 201);
    assert.equal(finishPairing.body.account.tokenName, "Personal Bookmarks");
    assert.equal(finishPairing.body.device.name, "Office Chrome");
    const secondDeviceToken = finishPairing.body.access_token;
    assert.notEqual(secondDeviceToken, firstDeviceToken);

    const reusedPairing = await fetchJson(`${baseUrl}/api/pairing/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.body.code, device_name: "Another Chrome" })
    });
    assert.equal(reusedPairing.status, 401);

    const sync = await fetchJson(`${baseUrl}/api/sync/apply`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firstDeviceToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "local_over_server",
        collection_name: "Shared",
        local_tree: {
          stableId: "root",
          type: "folder",
          title: "Shared",
          children: []
        }
      })
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.body.collection.id, 1);

    const repeatedSync = await fetchJson(`${baseUrl}/api/sync/apply`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secondDeviceToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "local_over_server",
        collection_name: "Shared",
        local_tree: {
          stableId: "root",
          type: "folder",
          title: "Shared",
          children: []
        }
      })
    });
    assert.equal(repeatedSync.status, 200);
    assert.equal(repeatedSync.body.collection.id, 1);
    assert.equal(repeatedSync.body.collection.revision, 2);

    const sameAccountCollections = await fetchJson(`${baseUrl}/api/collections`, {
      headers: { "Authorization": `Bearer ${secondDeviceToken}` }
    });
    assert.equal(sameAccountCollections.status, 200);
    assert.equal(sameAccountCollections.body.collections.length, 1);

    const storedData = await readFile(join(dataDir, "store.json"), "utf8");
    assert.match(storedData, /Personal Bookmarks/);
    assert.doesNotMatch(storedData, new RegExp(firstDeviceToken));
    assert.doesNotMatch(storedData, new RegExp(secondDeviceToken));
    assert.doesNotMatch(storedData, new RegExp(pairing.body.code));
  } finally {
    server.kill();
    await server.closed;
  }
});

test("local device authorization and local-over-server sync flow", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "xsync-test-"));
  const server = await startServer(dataDir);
  const baseUrl = server.baseUrl;

  try {
    const health = await fetchJson(`${baseUrl}/health`);
    assert.deepEqual(health.body, { ok: true, service: "xsync" });

    const login = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(login.status, 302);
    assert.match(login.headers.get("location") ?? "", /^\/xsync\/sso\/callback/);

    const callback = await fetch(`${baseUrl}/sso/callback?ticket=local&redirect=/`, { redirect: "manual" });
    assert.equal(callback.status, 302);
    const cookie = callback.headers.get("set-cookie") ?? "";
    assert.match(cookie, /xsync_session=/);

    const callbackAuthorizePage = await fetchText(`${baseUrl}/device/authorize?callback_url=${encodeURIComponent("xsync://device-authorized")}`, {
      headers: { "Cookie": cookie }
    });
    assert.equal(callbackAuthorizePage.status, 200);
    assert.match(callbackAuthorizePage.body, /xsync:\/\/device-authorized\?code=/);

    const unsafeAuthorizePage = await fetchText(`${baseUrl}/device/authorize?callback_url=${encodeURIComponent("https://evil.example/callback")}`, {
      headers: { "Cookie": cookie }
    });
    assert.equal(unsafeAuthorizePage.status, 200);
    assert.doesNotMatch(unsafeAuthorizePage.body, /evil\.example/);

    const authorize = await fetchJson(`${baseUrl}/api/device/authorize/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ device_name: "test chrome", platform: "chrome" })
    });
    assert.equal(authorize.status, 201);
    assert.equal(typeof authorize.body.code, "string");

    const finish = await fetchJson(`${baseUrl}/api/device/authorize/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: authorize.body.code })
    });
    assert.equal(finish.status, 201);
    assert.equal(finish.body.token_type, "Bearer");
    assert.equal(finish.body.device.name, "test chrome");

    const tree = {
      stableId: "root",
      type: "folder",
      title: "Test",
      children: [
        {
          stableId: "example",
          type: "bookmark",
          title: "Example",
          url: "https://example.com",
          children: []
        }
      ]
    };

    const sync = await fetchJson(`${baseUrl}/api/sync/apply`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${finish.body.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "local_over_server",
        collection_name: "Test",
        local_tree: tree
      })
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.body.collection.name, "Test");
    assert.equal(sync.body.collection.revision, 1);
    assert.equal(sync.body.tree.children[0].url, "https://example.com");

    const collections = await fetchJson(`${baseUrl}/api/collections`, {
      headers: { "Authorization": `Bearer ${finish.body.access_token}` }
    });
    assert.equal(collections.status, 200);
    assert.equal(collections.body.collections.length, 1);

    const refresh = await fetchJson(`${baseUrl}/api/device/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: finish.body.refresh_token })
    });
    assert.equal(refresh.status, 200);
    assert.notEqual(refresh.body.access_token, finish.body.access_token);
    assert.notEqual(refresh.body.refresh_token, finish.body.refresh_token);

    const reusedRefresh = await fetchJson(`${baseUrl}/api/device/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: finish.body.refresh_token })
    });
    assert.equal(reusedRefresh.status, 401);
    assert.equal(reusedRefresh.body.error, "invalid_refresh_token");

    const oldAccessCollections = await fetchJson(`${baseUrl}/api/collections`, {
      headers: { "Authorization": `Bearer ${finish.body.access_token}` }
    });
    assert.equal(oldAccessCollections.status, 401);

    const refreshedCollections = await fetchJson(`${baseUrl}/api/collections`, {
      headers: { "Authorization": `Bearer ${refresh.body.access_token}` }
    });
    assert.equal(refreshedCollections.status, 200);
    assert.equal(refreshedCollections.body.collections.length, 1);
  } finally {
    server.kill();
    await server.closed;
  }
});

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { status: response.status, body, headers: response.headers };
}

async function fetchText(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

async function startServer(dataDir, authMode = "local") {
  const child = spawn(process.execPath, ["src/server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTH_MODE: authMode,
      XSYNC_PORT: "0",
      XSYNC_DATA_DIR: dataDir,
      XSYNC_COOKIE_SECURE: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const started = await waitFor(() => output.includes("xsync listening"), 3000);
  if (!started) {
    child.kill();
    throw new Error(`server did not start:\n${output}`);
  }

  const match = output.match(/xsync listening on (http:\/\/[^\s]+)/);
  if (!match) {
    child.kill();
    throw new Error(`server started without URL:\n${output}`);
  }

  child.baseUrl = match[1];
  child.closed = closed;
  return child;
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}
