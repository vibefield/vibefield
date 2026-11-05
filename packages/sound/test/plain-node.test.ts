import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

// SD-1 — the package runs under plain Node as it stands (`.ts` specifiers, erasable syntax only: Node strips the
// types), so SD-3's package-time render and SD-4's CAF export are plain node scripts. One real `node` process
// imports the package by its name from its own directory (a package's self-reference, the way a script in the
// workspace resolves it) and renders the Done.
it("plain node imports @vibefield/sound and renders a Done", () => {
  const script = [
    'const { render, clearOf } = await import("@vibefield/sound");',
    'const r = render("done");',
    'console.log(JSON.stringify({ n: r.channels[0].length, strikes: r.meta.strikes, clear: clearOf("done"), node: process.version }));',
  ].join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const seen = JSON.parse(out.trim().split("\n").at(-1)!) as {
    n: number;
    strikes: number[];
    clear: number;
    node: string;
  };
  expect(seen.strikes).toEqual([0, 0.32]);
  expect(seen.clear).toBeCloseTo(0.77, 9);
  expect(seen.n).toBeGreaterThan(48000 * 3);
}, 60_000);
