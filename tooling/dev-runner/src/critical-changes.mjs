import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export async function discoverPluginProjects(repoRoot) {
  const projects = [];
  for (const collection of ["plugins", "examples/plugins"]) {
    const collectionRoot = join(repoRoot, collection);
    let entries;
    try {
      entries = await readdir(collectionRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = join(collectionRoot, entry.name);
      try {
        const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (
          typeof packageJson.name !== "string" ||
          typeof packageJson.scripts?.["gen:manifest"] !== "string"
        ) {
          continue;
        }
        projects.push(await describePlugin(repoRoot, root, packageJson.name));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function refreshPluginDescriptor(repoRoot, descriptor) {
  return describePlugin(repoRoot, resolve(repoRoot, descriptor.root), descriptor.name);
}

async function describePlugin(repoRoot, root, name) {
  const manifestFile = join(root, "vibefield.plugin.json");
  let serviceEntry = null;
  try {
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const entry = manifest?.entries?.service;
    if (typeof entry === "string" && entry.length > 0) {
      serviceEntry = normalize(relative(repoRoot, resolve(dirname(manifestFile), entry)));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    name,
    root: normalize(relative(repoRoot, root)),
    manifestFile: normalize(relative(repoRoot, manifestFile)),
    serviceEntry,
  };
}

export function classifyCriticalChange(path, pluginProjects) {
  const file = normalize(path);
  if (
    file.startsWith("packages/contracts/src/") ||
    file.startsWith("packages/contracts/scripts/")
  ) {
    return { kind: "contracts" };
  }
  if (
    file.startsWith("packages/field-native/src/") &&
    file !== "packages/field-native/src/contracts.rs"
  ) {
    return { kind: "native" };
  }
  if (file.startsWith("tooling/plugin-build/src/")) {
    return { kind: "all-manifests" };
  }

  const pluginLayout = file.match(/^(plugins|examples\/plugins)\/[^/]+\/(.+)$/);
  if (pluginLayout) {
    const inside = pluginLayout[2];
    if (
      inside === "package.json" ||
      inside === "src/manifest.ts" ||
      inside.startsWith("scripts/")
    ) {
      const known = pluginProjects.find((project) => file.startsWith(`${project.root}/`));
      return known ? { kind: "manifest", project: known.name } : { kind: "all-manifests" };
    }
    if (inside === "vibefield.plugin.json") {
      return { kind: "plugin-runtime" };
    }
  }

  for (const project of pluginProjects) {
    if (!file.startsWith(`${project.root}/`)) continue;
    if (file === project.serviceEntry) {
      return { kind: "plugin-runtime", project: project.name };
    }
  }
  return null;
}

export function shouldIgnoreWatchPath(path) {
  const segments = normalize(path).split("/");
  return segments.some((segment) =>
    [".git", ".nx", ".vibefield", "build", "coverage", "dist", "node_modules", "target"].includes(
      segment,
    ),
  );
}

function normalize(path) {
  return path.split("\\").join("/").replace(/^\.\//, "");
}
