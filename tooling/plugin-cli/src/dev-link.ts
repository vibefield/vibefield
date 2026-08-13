// `dev-link` — put a plugin where a developer-mode session will discover it.
//
// TWO AS-BUILT FACTS DECIDE THIS COMMAND'S MECHANISM, both probed rather than
// assumed (2026-08-13), because the obvious implementation — symlink the plugin
// directory into the dev root — does not work on this tree:
//
//  1. DISCOVERY SKIPS SYMLINKS. `plugin-registry.ts`'s walk keeps only entries
//     where `dirent.isDirectory()`, and a symlink to a directory reports
//     `isDirectory() === false`. A symlinked plugin dir is invisible to fieldd.
//  2. EL7 CONTAINMENT REFUSES LINKED ARTIFACTS. `plugin-modules.ts`'s
//     `isContainedFile` realpaths BOTH the module and the plugin root and
//     requires the first to sit under the second, freshly, on every resolve. So
//     even a real directory full of symlinked files would be discovered and then
//     refused at load — exactly the planted-link attack that check exists for.
//
// So the link is a COPY of the §5.2 bundle (manifest + dist/** + assets/**),
// dereferenced, into `<devRoot>/<id>/`: real directory, real files, discovered
// and loadable. The loop is `plugin-build` → `dev-link` → `plugins.reload`,
// which §18.5 already defines as re-reading the CURRENT on-disk manifest.
//
// WHERE the dev root is, honestly: the spec's per-user `…/VibeField/plugins/dev`
// is not what this tree implements. `resources.ts` hands fieldd
// `<repoRoot>/examples/plugins` in development and NOTHING when packaged (a
// package must not load unverified plugins), and `FIELDD_PLUGIN_DEV_ROOTS`
// overrides it. This command resolves in that same order and prints what it
// chose — it never invents a directory nothing reads.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { findWorkspaceRoot } from "./plugin-dir";
import { note, pass, refuse, type Verdict } from "./verdict";

/** The bundle members a dev link carries — the §5.2 installed shape. */
const BUNDLE_MEMBERS = ["vibefield.plugin.json", "dist", "assets"] as const;

/** Written INSIDE the copy so `--remove` can tell a link it made from a
 * directory someone else put there. A dotfile: discovery skips dotfiles. */
export const LINK_MARKER = ".vibefield-dev-link.json";

export interface DevRootResolution {
  readonly root: string;
  readonly origin: "flag" | "env" | "repo";
}

/**
 * Resolve the dev-linked plugin root: an explicit `--root`, else the first entry
 * of `FIELDD_PLUGIN_DEV_ROOTS` (the variable fieldd's own bin reads), else the
 * repo's development root as `resources.ts` defines it.
 *
 * EL7 note: `FIELD_*`/`FIELDD_*` are stripped from agent PTYs, so an agent will
 * usually land on the repo default — which is why the repo default exists here
 * rather than an error asking for the variable.
 */
export function resolveDevRoot(opts: {
  explicit?: string;
  env?: string | undefined;
  from: string;
}): DevRootResolution | undefined {
  if (opts.explicit !== undefined) return { root: resolve(opts.explicit), origin: "flag" };
  const fromEnv = (opts.env ?? "").split(delimiter).filter((s) => s.length > 0);
  if (fromEnv[0] !== undefined) return { root: resolve(fromEnv[0]), origin: "env" };
  const workspace = findWorkspaceRoot(opts.from);
  if (workspace === undefined) return undefined;
  return { root: join(workspace, "examples", "plugins"), origin: "repo" };
}

interface LinkMarker {
  source: string;
  linkedAt: number;
  tool: string;
}

function readMarker(dir: string): LinkMarker | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, LINK_MARKER), "utf8")) as LinkMarker;
  } catch {
    return undefined;
  }
}

export interface DevLinkResult {
  readonly verdicts: Verdict[];
  readonly linkPath?: string;
}

export function devLink(opts: {
  root: string;
  manifest: PluginManifestV1;
  devRoot: DevRootResolution;
  remove?: boolean;
  now?: number;
}): DevLinkResult {
  const linkPath = join(opts.devRoot.root, opts.manifest.id);

  if (opts.remove === true) {
    if (!existsSync(linkPath))
      return { verdicts: [note("dev-link", "link-missing", `nothing linked at ${linkPath}`)] };
    if (readMarker(linkPath) === undefined)
      return {
        verdicts: [
          refuse(
            "dev-link",
            "link-exists",
            `${linkPath} was not created by dev-link (no ${LINK_MARKER}) — refusing to delete it`,
            { pointer: linkPath },
          ),
        ],
      };
    rmSync(linkPath, { recursive: true, force: true });
    return { verdicts: [pass("dev-link", `unlinked ${linkPath}`)], linkPath };
  }

  if (existsSync(linkPath) && readMarker(linkPath) === undefined)
    return {
      verdicts: [
        refuse(
          "dev-link",
          "link-exists",
          `${linkPath} exists and was not created by dev-link — move it aside first`,
          { pointer: linkPath },
        ),
      ],
    };

  rmSync(linkPath, { recursive: true, force: true });
  mkdirSync(linkPath, { recursive: true });
  const copied: string[] = [];
  for (const member of BUNDLE_MEMBERS) {
    const from = join(opts.root, member);
    if (!existsSync(from)) continue;
    // dereference: a linked source file must land as a real file, or the EL7
    // containment check refuses it at load — the whole reason this is a copy.
    cpSync(from, join(linkPath, member), {
      recursive: statSync(from).isDirectory(),
      dereference: true,
    });
    copied.push(member);
  }
  const marker: LinkMarker = {
    source: opts.root,
    linkedAt: opts.now ?? Date.now(),
    tool: "@vibefield/plugin-cli dev-link",
  };
  writeFileSync(join(linkPath, LINK_MARKER), `${JSON.stringify(marker, null, 2)}\n`);

  const verdicts: Verdict[] = [
    pass("dev-link", `${opts.manifest.id} → ${linkPath} (${copied.join(", ") || "manifest only"})`),
    note(
      "dev-link",
      "dev-root-chosen",
      `dev root chosen from ${describeOrigin(opts.devRoot.origin)}: ${opts.devRoot.root}`,
    ),
  ];
  if (!copied.includes("dist"))
    verdicts.push(
      note(
        "dev-link",
        "activation-unbuilt",
        "no dist/ was copied — run plugin-build to make the widgets loadable",
      ),
    );
  verdicts.push(
    note(
      "dev-link",
      "dev-link-next-steps",
      "next: enable developer mode, then call plugins.reload — the copy is what the daemon re-reads, so re-run dev-link after each build",
      { expected: "plugin-build && vibefield-plugin dev-link <dir> && plugins.reload" },
    ),
  );
  return { verdicts, linkPath };
}

function describeOrigin(origin: DevRootResolution["origin"]): string {
  switch (origin) {
    case "flag":
      return "--root";
    case "env":
      return "FIELDD_PLUGIN_DEV_ROOTS";
    case "repo":
      return "the repo's development root (resources.ts: <repo>/examples/plugins)";
  }
}
