import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { resolveServiceModules } from "./service-graph.mjs";

export async function discoverPluginProjects(repoRoot, resolveModules = resolveServiceModules) {
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
        projects.push(await describePlugin(repoRoot, root, packageJson.name, resolveModules));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function refreshPluginDescriptor(
  repoRoot,
  descriptor,
  resolveModules = resolveServiceModules,
) {
  return describePlugin(
    repoRoot,
    resolve(repoRoot, descriptor.root),
    descriptor.name,
    resolveModules,
  );
}

async function describePlugin(repoRoot, root, name, resolveModules) {
  const manifestFile = join(root, "vibefield.plugin.json");
  let rendererEntry = null;
  let rendererStyle = null;
  let serviceEntry = null;
  try {
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const renderer = manifest?.entries?.renderer;
    if (typeof renderer === "string" && renderer.length > 0) {
      const rendererPath = resolve(dirname(manifestFile), renderer);
      rendererEntry = normalize(relative(repoRoot, rendererPath));
      rendererStyle = normalize(relative(repoRoot, join(dirname(rendererPath), "renderer.css")));
    }
    const entry = manifest?.entries?.service;
    if (typeof entry === "string" && entry.length > 0) {
      serviceEntry = normalize(relative(repoRoot, resolve(dirname(manifestFile), entry)));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  // The harness imports the entry live, so its whole relative-import closure
  // is runtime input; hash and watch all of it, not just the entry file.
  let serviceModules = [];
  if (serviceEntry !== null) {
    const resolved = await resolveModules(repoRoot, resolve(repoRoot, serviceEntry));
    serviceModules = resolved ?? [serviceEntry];
  }
  return {
    name,
    root: normalize(relative(repoRoot, root)),
    manifestFile: normalize(relative(repoRoot, manifestFile)),
    rendererEntry,
    rendererStyle,
    serviceEntry,
    serviceModules,
  };
}

export function serviceModulesOf(project) {
  if (Array.isArray(project.serviceModules)) return project.serviceModules;
  return project.serviceEntry ? [project.serviceEntry] : [];
}

export function rendererArtifactsOf(project) {
  return [project.rendererEntry, project.rendererStyle].filter(
    (path) => typeof path === "string" && path.length > 0,
  );
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
    return { kind: "all-plugin-builds" };
  }

  const pluginLayout = file.match(/^(plugins|examples\/plugins)\/[^/]+\/(.+)$/);
  if (pluginLayout) {
    const inside = pluginLayout[2];
    const known = pluginProjects.find((project) => file.startsWith(`${project.root}/`));
    if (
      inside === "package.json" ||
      inside === "src/manifest.ts" ||
      inside.startsWith("scripts/")
    ) {
      return known ? { kind: "manifest", project: known.name } : { kind: "all-manifests" };
    }
    if (inside === "vibefield.plugin.json") {
      return { kind: "plugin-runtime" };
    }
    if (known && serviceModulesOf(known).includes(file)) {
      return { kind: "plugin-runtime", project: known.name };
    }
    if (known && inside.startsWith("src/")) {
      return { kind: "plugin-build", project: known.name };
    }
    // A plugin may share renderer modules or assets with a sibling directory.
    // There is no safe owning-project inference for that layout, so rebuild
    // every artifact rather than leave one plugin serving stale bytes.
    if (!known && /\.(?:css|js|jsx|mjs|ts|tsx|svg|png|jpe?g|webp|woff2?)$/i.test(inside)) {
      return { kind: "all-plugin-builds" };
    }
  }

  // No root-prefix guard: a service entry may legally import a relative
  // module from outside its plugin directory, and that file is runtime input
  // all the same.
  for (const project of pluginProjects) {
    if (serviceModulesOf(project).includes(file)) {
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
