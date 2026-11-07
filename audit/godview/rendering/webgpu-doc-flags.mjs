// Two untried flag sets only. The Colab headless guide is a real-GPU recipe.
// The second set points that recipe at the only Vulkan ICD on this machine,
// Chrome's bundled SwiftShader. Already-tried sets are not repeated.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const root = import.meta.dirname;
const outDir = join(root, "webgpu-attempts");
mkdirSync(outDir, { recursive: true });
const chrome = "/usr/bin/google-chrome";
const icd = "/opt/google/chrome/vk_swiftshader_icd.json";
const pageUrl = "http://127.0.0.1:4173/swarm-repro.html?phase=react";

const common = [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu-sandbox",
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--disable-vulkan-surface",
  "--enable-unsafe-webgpu",
];

const attempts = [
  {
    id: "colab-guide",
    note: "developer.chrome.com/docs/web-platform/webgpu/colab-headless Puppeteer args. The guide says this is hardware Chrome, not SwiftShader.",
    args: common,
    env: {},
  },
  {
    id: "colab-guide-swiftshader-icd",
    note: "The same guide flags, plus --use-vulkan=swiftshader and --enable-unsafe-swiftshader, with VK_ICD_FILENAMES pointed at Chrome's bundled SwiftShader. That ICD is the only Vulkan driver installed here.",
    args: [...common, "--enable-unsafe-swiftshader", "--use-vulkan=swiftshader"],
    env: {
      VK_ICD_FILENAMES: icd,
      VK_DRIVER_FILES: icd,
    },
  },
];

function gpuLines(text) {
  return [...new Set(text.split("\n").map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim()))]
    .filter((line) => /WebGPU|GPU process|VK_KHR_|eglInitialize|Context Provider|swiftshader|Vulkan|vulkan/i.test(line))
    .slice(0, 20);
}

async function run(attempt) {
  const stderr = [];
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: false,
    ignoreDefaultArgs: true,
    env: { ...process.env, ...attempt.env },
    args: attempt.args,
  });
  const spawnargs = browser.process()?.spawnargs ?? [];
  browser.process()?.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
  const pageConsole = [];
  try {
    const page = await browser.newPage();
    page.on("console", (message) => pageConsole.push({ type: message.type(), text: message.text() }));
    await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("html[data-repro-done='1']", { timeout: 20000 });
    const traces = await page.$eval("#log", (node) => JSON.parse(node.textContent || "[]"));
    const shot = join(outDir, `${attempt.id}.png`);
    await page.screenshot({ path: shot });
    const empty = traces.find((trace) => trace.event === "react-settled")?.detail?.empty ?? null;
    const bodyPainted = typeof empty === "string" ? !empty.includes("WEBGPU UNAVAILABLE") : empty == null && traces.some((trace) => trace.event === "requestDevice:ok");
    return {
      id: attempt.id,
      note: attempt.note,
      args: attempt.args,
      env: attempt.env,
      spawnargs,
      chrome: await browser.version(),
      pageConsole,
      gpuProcess: gpuLines(stderr.join("")),
      traces,
      empty,
      bodyPainted,
      screenshot: `audit/godview/rendering/webgpu-attempts/${attempt.id}.png`,
    };
  } finally {
    await browser.close();
  }
}

const results = [];
for (const attempt of attempts) {
  results.push(await run(attempt));
  process.stdout.write(`${attempt.id} body=${results.at(-1).bodyPainted} empty=${JSON.stringify(results.at(-1).empty)}\n`);
}
const report = {
  kind: "webgpu-documented-flag-attempts",
  sourceSha: "748d015a7e393112e0a91dad80111fdf5abe6583",
  page: pageUrl,
  driver: {
    nvidiaSmi: "command not found",
    devDri: "absent",
    etcVulkanIcd: "empty",
    loader: "/usr/lib/x86_64-linux-gnu/libvulkan.so.1.3.275",
    bundledSwiftShader: "/opt/google/chrome/libvk_swiftshader.so",
    bundledIcd: icd,
  },
  notRepeated: [
    "--enable-unsafe-webgpu --enable-unsafe-swiftshader",
    "--use-gl=angle --use-angle=swiftshader --disable-features=Vulkan",
    "--use-gl=swiftshader --disable-features=Vulkan",
    "--enable-features=Vulkan --use-vulkan=swiftshader --disable-vulkan-surface",
    "--use-webgpu-adapter=swiftshader",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-webgpu --enable-unsafe-swiftshader --enable-features=Vulkan --use-vulkan=swiftshader with VK_ICD_FILENAMES",
  ],
  attempts: results,
};
writeFileSync(join(root, "webgpu-doc-flags.json"), `${JSON.stringify(report, null, 2)}\n`);
