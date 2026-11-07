import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ENTRIES, NOW } from "./inputs.mjs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const root = import.meta.dirname;
const integrationPath = join(root, "integration.json");
const outDir = join(root, "screenshots");
const chrome = "/usr/bin/google-chrome";

function startPreview() {
  const child = spawn(join(root, "node_modules", ".bin", "vite"), ["preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173/");
      if (response.ok) return;
    } catch {
      // preview is still binding the port
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("preview did not start");
}

const integration = JSON.parse(readFileSync(integrationPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const preview = startPreview();
let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    ignoreDefaultArgs: ["--disable-gpu"],
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-unsafe-swiftshader",
      "--lang=en-US",
    ],
  });
  const page = await browser.newPage();
  await page.emulateTimezone("UTC");
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  let swarmPaint = null;
  const results = [];
  for (const fixture of integration.fixtures) {
    if (fixture.requiresBodyPaint && swarmPaint === "webgpu-unavailable") {
      results.push({
        ...fixture,
        renderStatus: "hole",
        hole: "Swarm body paint needs WebGPU. This host mounted the 748d015 swarm and it reported WEBGPU UNAVAILABLE.",
        screenshot: "audit/godview/rendering/screenshots/environment-swarm.png",
      });
      continue;
    }
    const shot = join(outDir, `${fixture.fixtureId}.png`);
    if (process.env.SKIP_EXISTING === "1" && existsSync(shot) && fixture.requiresBodyPaint !== true) {
      results.push({
        ...fixture,
        renderStatus: "rendered",
        screenshot: `audit/godview/rendering/screenshots/${fixture.fixtureId}.png`,
      });
      continue;
    }
    const url = `http://127.0.0.1:4173/?fixture=${encodeURIComponent(fixture.fixtureId)}`;
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-fe-ready='1']", { timeout: 15000 });
    const stamp = await page.$eval("[data-source-sha]", (node) => ({
      sha: node.getAttribute("data-source-sha"),
      fidelity: node.getAttribute("data-fe-fidelity"),
    }));
    if (stamp.sha !== integration.sourceSha || stamp.fidelity !== "puppeteer-source") {
      throw new Error(`page stamp ${JSON.stringify(stamp)}`);
    }
    if (fixture.interact === "open-spawn") {
      await page.$eval("[data-list-spawn-button]", (button) => button.click());
      await page.waitForSelector("[role='menu']", { timeout: 5000 });
    }
    if (fixture.interact === "timeline-unborn" || fixture.interact === "timeline-unrecorded" || fixture.interact === "timeline-past") {
      const fraction = fixture.interact === "timeline-past" ? 0.9 : 0.17;
      const map = await page.$("[aria-label^='The head']");
      const box = await map.boundingBox();
      if (!box) throw new Error(`${fixture.fixtureId} has no timeline map`);
      await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
      const needle = fixture.interact === "timeline-unborn"
        ? "not started yet"
        : fixture.interact === "timeline-unrecorded"
          ? "not recorded"
          : "of ";
      await page.waitForFunction(
        (expected) => [...document.querySelectorAll(".vf-monitor-timeline-readout")].some((node) => (node.textContent ?? "").includes(expected)),
        { timeout: 5000 },
        needle,
      );
    }
    if (fixture.interact === "timeline-span") {
      const entry = ENTRIES.find((item) => item.fixtureId === fixture.fixtureId);
      const row = entry?.row ?? {};
      const observed = await page.evaluate(() => {
        const map = document.querySelector("[aria-label^='The head']");
        const head = document.querySelector(".vf-monitor-timeline-head");
        const readout = head?.querySelector(".vf-monitor-timeline-readout");
        return {
          pageNow: Date.now(),
          headMs: Number(map?.getAttribute("aria-valuenow")),
          valueText: map?.getAttribute("aria-valuetext") ?? "",
          tone: head?.getAttribute("data-tone") ?? null,
          recorded: head?.getAttribute("data-recorded") ?? null,
          readout: readout?.textContent ?? "",
        };
      });
      const horizon = 24 * 60 * 60 * 1000;
      const createdAt = row.createdAt ?? NOW;
      const statusSince = row.statusSince ?? createdAt;
      const sinceMs = Math.min(observed.pageNow, Math.max(createdAt, statusSince, observed.pageNow - horizon));
      const spanReadout = observed.tone === "working"
        && observed.recorded == null
        && observed.readout.includes("working")
        && !observed.readout.includes("not recorded")
        && !observed.readout.includes("not started");
      const evidence = {
        fixtureId: fixture.fixtureId,
        source: "TimelineView head dataset and readout, written from readoutAt(stateAt(lane, head))",
        pageNow: observed.pageNow,
        headMs: observed.headMs,
        sinceMs,
        valueText: observed.valueText,
        tone: observed.tone,
        recorded: observed.recorded,
        readout: observed.readout,
        headAtOrAfterSince: observed.headMs >= sinceMs,
        branch: spanReadout && observed.headMs >= sinceMs && observed.valueText.startsWith("Now") ? "span" : "not-span",
      };
      writeFileSync(join(root, "timeline-span-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
      if (evidence.branch !== "span") {
        throw new Error(`timeline span was not established: ${JSON.stringify(evidence)}`);
      }
    }
    if (fixture.interact === "spend-unknown") {
      const hit = await page.$(".vf-monitor-spend-hit");
      const box = await hit.boundingBox();
      if (!box) throw new Error(`${fixture.fixtureId} has no spend chart`);
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
      await page.waitForSelector("[data-state='unknown']", { timeout: 5000 });
    }
    const paint = await page.$eval(".fe-stage", (node) => node.getAttribute("data-fe-paint"));
    if (fixture.viewId === "view.swarm") swarmPaint = paint;
    const file = fixture.requiresBodyPaint && paint === "webgpu-unavailable"
      ? "environment-swarm.png"
      : `${fixture.fixtureId}.png`;
    await page.screenshot({ path: join(outDir, file) });
    if (fixture.requiresBodyPaint && paint === "webgpu-unavailable") {
      results.push({
        ...fixture,
        renderStatus: "hole",
        hole: "Swarm component from 748d015 mounted and reported WEBGPU UNAVAILABLE. Body predicates were not painted.",
        screenshot: `audit/godview/rendering/screenshots/${file}`,
      });
    } else {
      results.push({
        ...fixture,
        renderStatus: "rendered",
        paint,
        screenshot: `audit/godview/rendering/screenshots/${fixture.fixtureId}.png`,
      });
    }
  }
  integration.fixtures = results;
  integration.swarmBodyPaint = swarmPaint;
  const spanEvidencePath = join(root, "timeline-span-evidence.json");
  if (existsSync(spanEvidencePath)) {
    integration.timelineSpanEvidence = JSON.parse(readFileSync(spanEvidencePath, "utf8"));
  }
  writeFileSync(integrationPath, `${JSON.stringify(integration, null, 2)}\n`);
  const rendered = results.filter((item) => item.renderStatus === "rendered").length;
  process.stdout.write(`rendered ${rendered} of ${results.length}\n`);
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}
