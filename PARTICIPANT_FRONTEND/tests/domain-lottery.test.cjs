const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const eventId = "child-event-1";
const assignedAt = "2026-11-27T00:00:00.000Z";
const longText = (length, first, second) => {
  const prefix = `${first}\n\n${"TechnicalToken".repeat(45)} https://example.invalid/${"verylongpathsegment".repeat(12)}\n${second}\n`;
  return prefix + "Complete challenge content. ".repeat(Math.ceil((length - prefix.length) / 28)).slice(0, length - prefix.length);
};
const problemStatement = longText(20000, "Problem statement opening paragraph.", "A second paragraph keeps its original line break.");
const instructions = longText(10000, "Instructions opening line.", "• First complete instruction\n• Second complete instruction.");

async function browserChecks(origin, profile, width) {
  const browser = spawn(process.env.VIBRANT_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  let socket;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(port, "Browser must start");
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
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const result = await send("Runtime.evaluate", { expression: 'document.documentElement.dataset.domainLotteryTestsComplete ? JSON.stringify(window.__domainLotteryChecks) : ""', returnByValue: true });
      if (result.result.value) return JSON.parse(result.result.value);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Domain lottery browser checks must finish (${width}px)`);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
    socket?.close();
    if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), new Promise(resolve => setTimeout(() => { browser.kill(); resolve(); }, 2000))]);
  }
}

test("Domain lottery UI states, locked text integrity, request safety and mobile overflow", { timeout: 120000 }, async () => {
  let bundle;
  let assignment = null;
  let drawCount = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url === `/api/participant/events/${eventId}/domains/status`) {
      if (server.__scenario === "missing-status") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<pre>Cannot GET ${req.url}</pre>`);
        return;
      }
      const participantAssignment = server.__scenario === "individual" ? server.__initialAssignment : assignment;
      const entryType = server.__scenario === "individual" ? "INDIVIDUAL" : "TEAM";
      res.end(JSON.stringify({ success: true, data: {
        eventId, eventEligible: true, domainsEnabled: true, visibility: "PRIVATE", drawStatus: participantAssignment ? "CLOSED" : "OPEN",
        isEligible: true, entryType, canDraw: ["leader", "existing-race", "uncertain"].includes(server.__scenario) && !participantAssignment,
        hasAssignment: Boolean(participantAssignment), canReadAllDomains: false,
        reasonCode: participantAssignment ? "ASSIGNMENT_LOCKED" : server.__scenario === "member" ? "TEAM_LEADER_REQUIRED" : "DRAW_AVAILABLE", message: ""
      } }));
    } else if (req.url === `/api/participant/events/${eventId}/domains/my-theme`) {
      const participantAssignment = server.__scenario === "individual" ? server.__initialAssignment : assignment;
      res.end(JSON.stringify({ success: true, data: participantAssignment || { eventId, hasAssignment: false, isLocked: false, theme: null, assignedAt: null } }));
    } else if (req.method === "POST" && req.url === `/api/participant/events/${eventId}/domains/draw`) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        drawCount += 1;
        setTimeout(() => {
          assignment = { eventId, hasAssignment: true, isLocked: true, theme: { title: "Smart Agriculture", problemStatement, instructions }, assignedAt };
          res.statusCode = server.__scenario === "existing-race" ? 200 : server.__scenario === "uncertain" ? 503 : 201;
          res.end(JSON.stringify(res.statusCode === 503
            ? { success: false, code: "DOMAIN_COMMIT_UNKNOWN", message: "The assignment outcome is unknown." }
            : { success: true, data: { ...assignment, alreadyAssigned: res.statusCode === 200 } }));
          server.__drawRequest = { count: drawCount, body, contentType: req.headers["content-type"], statusCode: res.statusCode };
        }, 250);
      });
    } else if (req.url === "/test.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).contents);
    } else if (req.url === "/test.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(bundle.outputFiles.find(file => file.path.endsWith(".css")).contents);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"><style>html,body,#test-root{min-height:100%;margin:0}body{padding:12px;background:#f8fafb;font:14px Arial,sans-serif;box-sizing:border-box}*{box-sizing:border-box}</style><div id="test-root"></div><script>window.__domainLotteryScenario=${JSON.stringify(server.__scenario)};window.__domainLotteryExpectedStatement=${JSON.stringify(problemStatement)};window.__domainLotteryExpectedInstructions=${JSON.stringify(instructions)};</script><script src="/test.js"></script>`);
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), "vibrant-domain-lottery-"));
  try {
    bundle = await build({ entryPoints: [path.join(__dirname, "domain-lottery.browser.tsx")], outfile: "test.js", bundle: true, write: false, jsx: "automatic", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: origin }), "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
    const widths = [320, 360, 375, 390, 430, 768, 1280];
    for (const width of widths) {
      server.__scenario = "leader";
      server.__initialAssignment = null;
      assignment = null;
      drawCount = 0;
      requests.length = 0;
      server.__drawRequest = null;
      const results = await browserChecks(origin, path.join(profile, String(width)), width);
      for (const result of results) assert.ok(result.passed, `${width}px ${result.name}: ${result.detail || ""}`);
      assert.equal(server.__drawRequest?.count, 1, `${width}px: exactly one draw is sent after rapid taps`);
      assert.equal(server.__drawRequest?.body, "{}", `${width}px: draw sends an empty JSON object`);
      assert.match(server.__drawRequest?.contentType || "", /^application\/json/);
      assert.ok(requests.every(url => !/\/domains\/?(?:\?|$)/.test(url)), `${width}px: full-bank API is never requested`);
      console.log(`${width}px: ${results.length} browser assertions passed; one draw request; no bank request`);
    }

    server.__scenario = "member";
    assignment = null;
    drawCount = 0;
    requests.length = 0;
    const memberResults = await browserChecks(origin, path.join(profile, "member"), 375);
    for (const result of memberResults) assert.ok(result.passed, `team member ${result.name}: ${result.detail || ""}`);
    assert.equal(drawCount, 0, "An unassigned team member cannot submit a draw");
    assert.ok(requests.every(url => !/\/domains\/?(?:\?|$)/.test(url)), "The team member view never requests the full bank");

    server.__scenario = "individual";
    const individualAssignment = { eventId, hasAssignment: true, isLocked: true,
      theme: { title: "Smart Agriculture", problemStatement, instructions }, assignedAt };
    server.__initialAssignment = individualAssignment;
    requests.length = 0;
    const individualResults = await browserChecks(origin, path.join(profile, "individual"), 375);
    for (const result of individualResults) assert.ok(result.passed, `individual ${result.name}: ${result.detail || ""}`);
    assert.equal(drawCount, 0, "An existing individual assignment does not create another draw");
    assert.ok(requests.every(url => !/\/domains\/?(?:\?|$)/.test(url)), "The individual view never requests the full bank");

    server.__scenario = "existing-race";
    server.__initialAssignment = null;
    assignment = null;
    drawCount = 0;
    requests.length = 0;
    server.__drawRequest = null;
    const concurrentResults = await browserChecks(origin, path.join(profile, "existing-race"), 375);
    for (const result of concurrentResults) assert.ok(result.passed, `concurrent existing assignment ${result.name}: ${result.detail || ""}`);
    assert.equal(server.__drawRequest?.statusCode, 200, "Existing-assignment draw response uses HTTP 200");
    assert.equal(server.__drawRequest?.count, 1, "Concurrent assignment is reconciled by one draw request");
    assert.ok(requests.every(url => !/\/domains\/?(?:\?|$)/.test(url)), "Concurrent assignment handling never requests the full bank");

    server.__scenario = "uncertain";
    server.__initialAssignment = null;
    assignment = null;
    drawCount = 0;
    requests.length = 0;
    server.__drawRequest = null;
    const uncertainResults = await browserChecks(origin, path.join(profile, "uncertain"), 375);
    for (const result of uncertainResults) assert.ok(result.passed, `uncertain draw reconciliation ${result.name}: ${result.detail || ""}`);
    assert.equal(server.__drawRequest?.statusCode, 503, "Uncertain draw response is simulated");
    assert.equal(server.__drawRequest?.count, 1, "Uncertain outcome does not trigger an automatic second POST");
    assert.ok(requests.some(url => url === `/api/participant/events/${eventId}/domains/my-theme`), "Uncertain outcome is reconciled using GET my-theme");

    server.__scenario = "missing-status";
    server.__initialAssignment = null;
    assignment = null;
    drawCount = 0;
    requests.length = 0;
    const missingStatusResults = await browserChecks(origin, path.join(profile, "missing-status"), 375);
    for (const result of missingStatusResults) assert.ok(result.passed, `missing backend status route ${result.name}: ${result.detail || ""}`);
    assert.equal(requests.filter(url => url === `/api/participant/events/${eventId}/domains/status`).length, 2, "Retry repeats the status GET");
    assert.equal(drawCount, 0, "A missing status endpoint never initiates a draw");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(profile).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(profile).startsWith("vibrant-domain-lottery-"), "Browser profile cleanup must stay inside its temporary directory");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
