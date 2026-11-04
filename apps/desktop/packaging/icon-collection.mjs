import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// These are packaging destinations, not paths supplied by an imported manifest.
// Preserve the reviewed studio pixels, including its size-specific optical tuning.
export const COLLECTION_ASSETS = [
  ...["icon.json", "Assets/mark-light.svg", "Assets/mark-dark.svg"].map((file) => ({
    source: `macos/vibefield.icon/${file}`,
    target: `icons/app.icon/${file}`,
    role: "apple-source",
  })),
  { source: "windows/vibefield.ico", target: "icons/app.ico", role: "app-ico" },
  {
    source: "windows/vibefield-1024.png",
    target: "icons/app-1024.png",
    role: "app-png",
    size: 1024,
  },
  ...[16, 24, 32, 48, 64, 96, 128, 256, 512, 1024].map((size) => ({
    source: `linux/hicolor/${size}x${size}/apps/vibefield.png`,
    target: `icons/linux/${size}x${size}.png`,
    role: "app-png",
    size,
  })),
  { source: "linux/hicolor/scalable/apps/vibefield.svg", target: "icons/app.svg", role: "app-svg" },
  ...["Contents.json", "AppIcon.png", "AppIcon-Dark.png", "AppIcon-Tinted.png"].map((file) => ({
    source: `ios/Assets.xcassets/AppIcon.appiconset/${file}`,
    target: `../../ios/App/Assets.xcassets/AppIcon.appiconset/${file}`,
    role: file.endsWith(".png") ? "ios-png" : "ios-metadata",
    file,
  })),
  { source: "tray/macos/vibefieldTemplate.svg", target: "icons/tray-master.svg", role: "tray-svg" },
  ...["ready", "attention", "update", "offline"].flatMap((state) => {
    const suffix = state === "ready" ? "" : state[0].toUpperCase() + state.slice(1);
    const linuxSuffix = state === "ready" ? "" : `-${state}`;
    return [
      ...[1, 2].map((scale) => ({
        source: `tray/macos/18pt/vibefield${suffix}Template${scale === 2 ? "@2x" : ""}.png`,
        target: `tray/field${suffix}Template${scale === 2 ? "@2x" : ""}.png`,
        role: "template-png",
        size: 18 * scale,
        state,
        scale,
      })),
      ...["light", "dark"].flatMap((appearance) => [
        {
          source: `tray/windows/${appearance}/vibefield-${state}.ico`,
          target: `tray/field-${state}${appearance === "dark" ? "-dark" : ""}.ico`,
          role: "tray-ico",
          state,
          appearance,
        },
        {
          source: `tray/linux/${appearance}/vibefield-${state}-32.png`,
          target: `tray/field-linux${linuxSuffix}${appearance === "dark" ? "-dark" : ""}.png`,
          role: "tray-png",
          size: 32,
          state,
          appearance,
        },
      ]),
    ];
  }),
];

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** No Downloads dependency: the selected export and its recipe travel with the repo. */
export async function loadIconCollection(root) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files))
    throw new Error("Invalid icon collection manifest");
  const names = ["recipe.json", ...COLLECTION_ASSETS.map((asset) => asset.source)].sort();
  if (JSON.stringify(manifest.files.map((file) => file.path).sort()) !== JSON.stringify(names)) {
    throw new Error("Icon collection manifest does not match the desktop/iOS asset contract");
  }
  const files = new Map();
  for (const entry of manifest.files) {
    const bytes = await readFile(join(root, entry.path));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Reviewed icon source changed: ${entry.path}`);
    }
    files.set(entry.path, bytes);
  }
  const recipe = JSON.parse(files.get("recipe.json").toString("utf8"));
  if (recipe.version !== 1 || recipe.style !== "plain" || recipe.appearance !== "light") {
    throw new Error("The shipping icon collection must be the reviewed plain light/dark family");
  }
  const actual = (await listFiles(root)).filter((name) => name !== "manifest.json").sort();
  if (JSON.stringify(actual) !== JSON.stringify(names))
    throw new Error("Unexpected files in the reviewed icon collection");
  const appleSourceHash = createHash("sha256");
  for (const asset of COLLECTION_ASSETS.filter((entry) => entry.role === "apple-source")) {
    appleSourceHash.update(asset.source).update("\0").update(files.get(asset.source));
  }
  return { files, recipe, appleSourceSha256: appleSourceHash.digest("hex") };
}

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Icon collection may not contain links or special files: ${path}`);
  }
  return files;
}
