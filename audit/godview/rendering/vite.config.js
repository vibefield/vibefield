import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pin = join(import.meta.dirname, ".pin", "puppeteer");
const SHA = "748d015a7e393112e0a91dad80111fdf5abe6583";
const SWARM = "d8a7b53b43be8cdcab2e95f6d541b66e46a9357a";

function git(args) {
  return execFileSync("git", args, { cwd: pin, encoding: "utf8" }).trim();
}

function pinStamp() {
  return {
    name: "puppeteer-pin-stamp",
    resolveId(id) {
      if (id === "virtual:pin-stamp") return "\0pin-stamp";
      return null;
    },
    load(id) {
      if (id !== "\0pin-stamp") return null;
      const head = git(["rev-parse", "HEAD"]);
      const swarm = git(["rev-parse", "HEAD:packages/views/src/views/swarm/AgentSwarm.tsx"]);
      if (head !== SHA || swarm !== SWARM) {
        throw new Error(`refusing to bundle: pin ${head} swarm ${swarm}`);
      }
      return `export const PIN_STAMP = ${JSON.stringify({
        fidelity: "puppeteer-source",
        sourceSha: head,
        swarmBlob: swarm,
        newerThanShippedPackage: "0.3.3",
        shippedPackageRendered: false,
      })};`;
    },
  };
}

function refuseInstalledPuppeteer() {
  return {
    name: "refuse-installed-puppeteer",
    resolveId(id) {
      if (id.includes("node_modules/@vibefield/puppeteer")) {
        throw new Error(`refusing installed package import ${id}`);
      }
      return null;
    },
  };
}

function swarmWorker() {
  return {
    name: "pin-swarm-worker",
    resolveId(source, importer) {
      if (!source.endsWith("swarm-physics.worker.js") || !importer) return null;
      return join(dirname(importer), "swarm-physics.worker.ts");
    },
  };
}

const sdk = join(pin, "packages/view-sdk/src");
const views = join(pin, "packages/views/src");
const modules = join(import.meta.dirname, "node_modules");

export default defineConfig({
  base: "./",
  plugins: [react(), pinStamp(), refuseInstalledPuppeteer(), swarmWorker()],
  resolve: {
    alias: {
      react: join(modules, "react"),
      "react-dom": join(modules, "react-dom"),
      "matter-js": join(modules, "matter-js"),
      "@vibefield/puppeteer-view-sdk/react": join(sdk, "react/index.ts"),
      "@vibefield/puppeteer-view-sdk/host": join(sdk, "host/index.ts"),
      "@vibefield/puppeteer-view-sdk/toolkit": join(sdk, "toolkit/index.ts"),
      "@vibefield/puppeteer-view-sdk/model": join(sdk, "model.ts"),
      "@vibefield/puppeteer-view-sdk": join(sdk, "index.ts"),
      "@puppeteer-pin/views": views,
      "@puppeteer-pin/sdk": sdk,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { allow: [import.meta.dirname, pin, "/tmp/puppeteer-748d015", "/workspace"] },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: join(import.meta.dirname, "index.html"),
        swarmRepro: join(import.meta.dirname, "swarm-repro.html"),
      },
    },
  },
});
