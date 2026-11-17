const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const parseProof = require("../../backend/middleware/paymentProofUpload");

async function browserResults(origin, profile, width) {
  const browser = spawn(process.env.VIBRANT_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  let socket;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(port, "Test browser must start");
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const result = JSON.parse(event.data);
      if (pending.has(result.id)) { const { resolve, reject } = pending.get(result.id); pending.delete(result.id); if (result.error) reject(Error(result.error.message)); else resolve(result.result); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const result = await send("Runtime.evaluate", { expression: 'document.getElementById("test-results")?.textContent', returnByValue: true });
      if (result.result.value) return JSON.parse(result.result.value);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Browser tests must finish (${width}px)`);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
    socket?.close();
    if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), new Promise(resolve => setTimeout(() => { browser.kill(); resolve(); }, 2000))]);
  }
}

test("Payment selection, StrictMode preview, QR sizing and real multipart transport", { timeout: 60000 }, async () => {
  const uploads = [];
  let bundle;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64");
  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      res.status = code => { res.statusCode = code; return res; };
      res.json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
      parseProof(req, res, () => {
        uploads.push({ path: req.url, type: req.headers["content-type"], file: req.file, body: req.body });
        res.json({ success: true, registration: { _id: "individual", status: "REGISTERED", payment: { status: "PENDING", method: "UPI" } }, team: { id: "team", teamName: "Test Team", memberCount: 1, payment: { status: "PENDING" } }, proofUrl: "https://example.invalid/test-proof.png" });
      });
    } else if (req.url === "/api/auth/me") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ success: true, user: { id: "test-user", name: "Test User", email: "test@example.invalid", role: "PARTICIPANT", profilePicture: null } })); }
    else if (req.url === "/api/registrations/my") { setTimeout(() => { if (!res.destroyed) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ success: true, registrations: [] })); } }, 180); }
    else if (/^\/api\/events\/(individual|team)$/.test(req.url)) {
      const mode = req.url.endsWith("/team") ? "TEAM" : "INDIVIDUAL";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, event: { _id: mode === "TEAM" ? "team" : "individual", name: `Test ${mode} Event`, category: "TECHNICAL", status: "PUBLISHED", venue: "Test Venue", startDate: "2035-12-20", endDate: "2035-12-21", paymentQrUrl: "/qr-a.png", registration: { mode, registeredParticipants: 0, capacity: 20, minTeamSize: 2, maxTeamSize: 5, deadline: "2035-12-19", registrationFee: 100 }, registrationFields: [] } }));
    }
    else if (req.url === "/test.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).contents); }
    else if (req.url === "/test.css") { res.setHeader("Content-Type", "text/css"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css")).contents); }
    else if (req.url.endsWith(".png")) { res.setHeader("Content-Type", "image/png"); res.end(png); }
    else { res.setHeader("Content-Type", "text/html"); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"><style>body{margin:0;padding:16px;box-sizing:border-box}*{box-sizing:border-box}</style><div id="test-root"></div><script src="/test.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), "vibrant-payment-ui-"));
  try {
    bundle = await build({ entryPoints: [path.join(__dirname, "payment-ui.browser.tsx")], outfile: "test.js", bundle: true, write: false, jsx: "automatic", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: origin }), "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
    const widths = [1280, 360, 390, 430];
    for (const width of widths) {
      const results = await browserResults(origin, path.join(profile, String(width)), width);
      for (const result of results) assert.ok(result.passed, `${result.name}: ${result.detail || ""}`);
      console.log(`${width}px: ${results.length} browser assertions passed`);
      console.log(results.filter(result => result.name === "QR is large and contained").map(result => result.detail).join("; "));
    }
    assert.equal(uploads.length, widths.length * 6);
    for (const upload of uploads) {
      assert.match(upload.type, /^multipart\/form-data; boundary=/);
      assert.equal(upload.file.fieldname, "screenshot");
      assert.equal(upload.file.originalname, "payment.png");
      assert.deepEqual(upload.file.buffer, png);
      if (upload.path.includes("/events/")) assert.equal(upload.body.paymentMethod, "UPI");
    }
    for (const [file, expectedStatus] of [
      [new File(["invalid"], "bad.txt", { type: "text/plain" }), 400],
      [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), 413]
    ]) {
      const form = new FormData(); form.append("screenshot", file);
      const result = await fetch(`${origin}/api/events/individual/register`, { method: "POST", body: form });
      assert.equal(result.status, expectedStatus, "Existing Multer validation rejects invalid uploads");
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(profile).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(profile).startsWith("vibrant-payment-ui-"), "Cleanup must stay inside the temporary test profile directory");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
