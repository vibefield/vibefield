#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Development bundles live outside dist, but clean every production-owned
// shell directory as a second line of defense against stale or interrupted
// builds. Renderer output belongs to build:renderer and is intentionally kept.
await Promise.all(
  ["main", "preload", "testing"].map((directory) =>
    rm(join(packageRoot, "dist", directory), { recursive: true, force: true }),
  ),
);
