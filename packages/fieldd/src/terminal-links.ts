import { fileURLToPath } from "node:url";
import {
  type CallerContext,
  isUnambiguousLinkText,
  ShellLinkUrl,
  type ShellOpenLinkParams,
  type ShellOpenLinkResult,
  ShellRevealPathParams,
  type ShellRevealPathResult,
  TERMINAL_LINK_MAX_CHARS,
  TerminalLinkOpenParams,
  type TerminalLinkOpenResult,
} from "@vibefield/contracts";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";
import { RpcCallError } from "./native-link";

// GT-8a — terminal links: fieldd's POLICY door for `terminal.link.open`
// (GT-D22). ghosttea's runtime finds a link in a pane's output and, on
// ⌘-click, hands the deck its URL; the deck asks here, and this decides what
// the click may do. The rule is VibeField's own and stricter than ghosttea
// desktop's (which opens every scheme its validator admits), because a
// same-uid agent can print any link it likes and one click must never run
// anything (EL7):
//
// - `http:` / `https:` → the default browser, through the shell provider's
//   internal `shell.openLink`, in the URL standard's own spelling. http is
//   admitted for the dev servers on localhost a terminal prints most.
// - `file:` naming an absolute path on THIS device → SHOWN in the file manager
//   (`shell.revealPath`), never opened: opening a `.command` file or an app
//   would run it.
// - everything else (mailto, ftp, a custom scheme) → PRECONDITION_FAILED, and
//   main is asked nothing.
//
// Electron main owns only the mechanism, and re-checks the web half against
// its own contract (`ShellOpenLinkParams`) before the browser sees it. Who may
// ask at all is the registry row's scope, `terminal.link`: the window's token
// holds it and no plugin, tailnet or MCP principal can.

/** Where a link may go, once the policy has read it. */
export type TerminalLinkTarget =
  | { kind: "web"; scheme: "http" | "https"; url: string }
  | { kind: "file"; path: string };

export type TerminalLinkVerdict = TerminalLinkTarget | { kind: "refused"; reason: string };

function refused(reason: string): TerminalLinkVerdict {
  return { kind: "refused", reason };
}

/** GT-D22 as a function: what one link may do on this device. `platform`
 * decides how a file URL becomes a path (a drive letter is Windows'); tests
 * name it, production reads the process's own. */
export function terminalLinkTarget(
  raw: string,
  platform: NodeJS.Platform = process.platform,
): TerminalLinkVerdict {
  // Refused before the parser can repair it: what opens must be what was shown.
  if (!isUnambiguousLinkText(raw)) {
    return refused(
      "a link may not carry whitespace, control or invisible characters, or backslashes",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refused("it is not an absolute URL");
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    // The standard's own spelling is what the browser receives, so the
    // contract judges exactly that string: no credentials, and within the
    // bound once the standard has percent-encoded it.
    const href = ShellLinkUrl.safeParse(url.href);
    if (!href.success) {
      return refused(
        `a web link may carry no credentials and must fit in ${TERMINAL_LINK_MAX_CHARS} characters`,
      );
    }
    return { kind: "web", scheme: url.protocol === "http:" ? "http" : "https", url: href.data };
  }
  if (url.protocol === "file:") return fileTarget(raw, url, platform);
  return refused("only web links (http, https) and file links do anything from a terminal");
}

/** A `file:` link as a path on this device, or why it is not one. */
function fileTarget(raw: string, url: URL, platform: NodeJS.Platform): TerminalLinkVerdict {
  // ghosttea's own rule, kept: only `file://…` spells a path through an
  // authority. The URL standard reads `file:notes.txt` as `/notes.txt` — a
  // relative name promoted to the root, which is not what anyone printed.
  if (!raw.toLowerCase().startsWith("file://")) {
    return refused("a file link must be spelled file:// and name an absolute path");
  }
  // A host names another machine: its path means nothing here, and on Windows
  // revealing `\\host\share` would open a network connection to wherever the
  // link points. (`file://localhost/…` has no host once parsed.)
  if (url.hostname !== "") return refused("a file link must name a file on this device");
  let path: string;
  try {
    path = fileURLToPath(url, { windows: platform === "win32" });
  } catch {
    // an encoded separator, or on Windows a path without a drive
    return refused("a file link must name an absolute path on this device");
  }
  // The decoded name is held to the link's own rule: no control or invisible
  // characters in what the file manager will be asked to show.
  if (/[\p{Cc}\p{Cf}]/u.test(path) || !ShellRevealPathParams.safeParse({ path }).success) {
    return refused("a file link must name an absolute path on this device");
  }
  return { kind: "file", path };
}

/** The shell provider's two doors a link reaches. `ProductApi` satisfies it
 * structurally; tests pass a script and never a real broker. */
export interface TerminalLinkShell {
  openLink(params: ShellOpenLinkParams): Promise<ShellOpenLinkResult>;
  revealPath(params: ShellRevealPathParams): Promise<ShellRevealPathResult>;
}

/** The slice of AuditService the door needs: attempt → effect → outcome. */
export interface TerminalLinkAudit {
  required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
}

export interface TerminalLinkDoorOptions {
  shell: TerminalLinkShell;
  audit: TerminalLinkAudit;
  /** how a file URL becomes a path; the process's own by default */
  platform?: NodeJS.Platform;
}

/** `terminal.link.open`. A refusal — a caller off this machine, a malformed
 * call, a link the policy will not open — comes before the audit and before
 * main is asked, as `shell.openExternal`'s malformed URL does: nothing
 * happened. What does happen is audited like `shell.open.external`: the
 * opener and the scheme, never the URL or the path, either of which can
 * carry a token or a name. */
export function createTerminalLinkDoor(
  options: TerminalLinkDoorOptions,
): (ctx: CallerContext, params: unknown) => Promise<TerminalLinkOpenResult> {
  const { shell, audit } = options;
  const platform = options.platform ?? process.platform;
  return async (ctx, params) => {
    // The shell provider's posture for its client doors
    // (`ShellProviderBroker.call`): a desktop operation is for a caller on
    // this machine. The dispatch below is internal and would not ask again.
    if (ctx.transport !== "ws-loopback") {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "desktop shell operations are available only to local callers",
        false,
      );
    }
    const parsed = TerminalLinkOpenParams.safeParse(params);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `expected { url: string } of at most ${TERMINAL_LINK_MAX_CHARS} characters`,
        false,
      );
    }
    const target = terminalLinkTarget(parsed.data.url, platform);
    if (target.kind === "refused") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `terminal link refused: ${target.reason}`,
        false,
      );
    }
    return await audit.required(
      ctx,
      {
        action: "terminal.link.open",
        target: {
          kind: "shell-operation",
          id: target.kind === "web" ? "system-browser" : "file-manager",
        },
        attrs: { scheme: target.kind === "web" ? target.scheme : "file" },
      },
      async (): Promise<TerminalLinkOpenResult> => {
        if (target.kind === "web") {
          await shell.openLink({ url: target.url });
          return { outcome: "opened" };
        }
        await shell.revealPath({ path: target.path });
        return { outcome: "revealed" };
      },
      () => ({ outcome: "succeeded" }),
    );
  };
}
