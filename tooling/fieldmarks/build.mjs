import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromShell = createRequire(join(root, "packages/electron-shell/package.json"));
const { build } = requireFromShell("esbuild");
const app = join(root, "packages/field-app");
const temp = await mkdtemp(join(tmpdir(), "vf-fieldmarks-build-"));

try {
  execFileSync("python3", [join(root, "tooling/fieldmarks/generate.py")], { stdio: "inherit" });
  const archive = await readFile(join(root, "docs/design/vibefield-fieldmarks.zip"));
  const archiveUrl = `data:application/zip;base64,${archive.toString("base64")}`;
  const define = {
    "process.env.NODE_ENV": '"production"',
    __VF_FIELDMARKS_ARCHIVE__: JSON.stringify(archiveUrl),
  };
  const client = await build({
    entryPoints: [join(app, "src/design-system/fieldmarks-entry.tsx")],
    bundle: true,
    write: false,
    outfile: join(temp, "fieldmarks.js"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    minify: true,
    legalComments: "inline",
    define,
  });
  const javascript = client.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = client.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!javascript || !css) throw new Error("The catalogue build did not emit JavaScript and CSS.");

  // Render the SAME catalogue before hydration, so the artwork and research remain readable
  // without JavaScript. This is generated markup from real components, never a parallel mockup.
  const renderer = join(temp, "render.cjs");
  await build({
    stdin: {
      contents: `import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FieldmarksReport } from "./src/design-system/FieldmarksReport.tsx";
process.stdout.write(renderToString(createElement(FieldmarksReport, { archiveUrl: __VF_FIELDMARKS_ARCHIVE__ })));`,
      resolveDir: app,
      sourcefile: "fieldmarks-render.ts",
    },
    outfile: renderer,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define,
  });
  const markup = execFileSync(process.execPath, [renderer], { encoding: "utf8", maxBuffer: 8e6 });
  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="AFTER HOURS: 78 retro vector stickers for VibeField. Original characters, odd hardware, ink proofs, and two SVG export finishes.">
<title>AFTER HOURS — VibeField Sticker Club</title>
<style>${css}</style>
</head>
<body>
<noscript><p style="padding:16px;font:14px system-ui">All drawings and the design brief are visible. Enable JavaScript to filter, inspect, and change previews. The complete SVG download remains available.</p></noscript>
<div id="fieldmarks-root">${markup}</div>
<script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
  const output = join(root, "docs/design/fieldmarks.html");
  await writeFile(output, html);
  console.log(`Built ${output} (${Buffer.byteLength(html).toLocaleString()} bytes).`);
  console.log(
    "React, CSS, original vectors, rendered catalogue, and the ZIP download are embedded.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
