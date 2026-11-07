// Runs the unmodified 748d015 renderer under the same Chrome flags, one
// process per phase so a destroyed device cannot poison the next question.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const root = import.meta.dirname;
const chrome = "/usr/bin/google-chrome";
const args = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu-sandbox",
  "--enable-unsafe-webgpu",
  "--enable-unsafe-swiftshader",
];

function start(command, commandArgs, port) {
  const child = spawn(command, commandArgs, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return child;
}

async function wait(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/swarm-repro.html`);
      if (response.ok) return;
    } catch {
      // server still binding
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`port ${port} did not serve swarm-repro.html`);
}

async function phase(port, name, search) {
  const stderr = [];
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    dumpio: true,
    ignoreDefaultArgs: ["--disable-gpu"],
    args,
  });
  browser.process()?.stderr?.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });
  try {
    const page = await browser.newPage();
    const pageConsole = [];
    page.on("console", (message) => {
      pageConsole.push({ type: message.type(), text: message.text() });
    });
    await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/swarm-repro.html?${search}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("html[data-repro-done='1']", { timeout: 20000 });
    const traces = await page.$eval("#log", (node) => JSON.parse(node.textContent || "[]"));
    const version = await browser.version();
    const gpuLines = [...new Set(stderr.join("").split("\n").map((line) => line.replace(/^\[[^\]]+\]\s*/, "")))]
      .filter((line) => /WebGPU|GPU process|VK_KHR_|eglInitialize|Context Provider|swiftshader/i.test(line))
      .slice(0, 12);
    return { phase: name, search, chrome: version, traces, pageConsole, gpuProcess: gpuLines };
  } finally {
    await browser.close();
  }
}

const dev = start(join(root, "node_modules/vite/bin/vite.js"), [
  "--host",
  "127.0.0.1",
  "--port",
  "4174",
  "--strictPort",
]);
const preview = start(join(root, "node_modules/vite/bin/vite.js"), [
  "preview",
  "--host",
  "127.0.0.1",
  "--port",
  "4175",
  "--strictPort",
]);

try {
  await Promise.all([wait(4174), wait(4175)]);
  const runs = [];
  for (const name of ["bare-hold", "bare-destroy", "bare-renderer", "bare-renderer-destroy"]) {
    runs.push(await phase(4175, `production-${name}`, `phase=${name}`));
  }
  runs.push(await phase(4175, "production-react", "phase=react"));
  runs.push(await phase(4174, "development-react-strict", "phase=react&strict=1"));
  runs.push(await phase(4174, "development-react", "phase=react"));
  const out = {
    kind: "swarm-lifecycle-repro",
    sourceSha: "748d015a7e393112e0a91dad80111fdf5abe6583",
    flags: args,
    note: "Instrumentation wraps requestAdapter, requestDevice, destroy, and lost, then calls the original. createSwarmRenderer and AgentSwarm are unmodified.",
    runs,
  };
  writeFileSync(join(root, "swarm-lifecycle.json"), `${JSON.stringify(out, null, 2)}\n`);
  for (const run of runs) {
    const events = run.traces.map((trace) => trace.event).join(" > ");
    process.stdout.write(`${run.phase}: ${events}\n`);
  }
} finally {
  dev.kill("SIGTERM");
  preview.kill("SIGTERM");
}
