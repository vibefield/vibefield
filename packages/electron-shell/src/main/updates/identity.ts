// WP12b (build-wp12-updater.md D9; EDP-30) — where updates come from and what verifies them, read from the staged
// public identity (`Resources/identity/release-identity.json`): the frozen origin, the build's channel and the
// EMBEDDED root keys. Null in the development layout (no identity → no updater: it runs only in a packaged app).
//
// D9: `VIBEFIELD_UPDATE_ORIGIN` (a fixture release origin for the DEV-keyed witnesses) is honored ONLY when the staged
// key class is `dev` — itself bootable only under `--allow-dev-trust`. A release-keyed app reads its origin from the
// identity alone; the environment cannot point it anywhere else.

import { readFileSync } from "node:fs";
import { type KeyClass, StagedReleaseIdentity, type UpdateChannel } from "@vibefield/contracts";
import type { DesktopResources } from "../resources";
import { NOTHING_REMEMBERED, type RememberedVersions } from "./verify-chain";

export const UPDATE_ORIGIN_OVERRIDE_ENV = "VIBEFIELD_UPDATE_ORIGIN";

export interface UpdateIdentity {
  readonly origin: string;
  readonly channel: UpdateChannel;
  readonly rootKeys: readonly string[];
  readonly keyClass: KeyClass;
  /** True when a dev-keyed build took its origin from `VIBEFIELD_UPDATE_ORIGIN`. */
  readonly originOverridden: boolean;
  /** The build-time floor: the signed-document versions this build was staged with (none on a pre-WP12 stage). */
  readonly floors: RememberedVersions;
  /** AU-4 (AU-G9) — WP12 D10's `<appVersion>+<commit7>`, for About's commit; absent on a stage cut before WP12c */
  readonly buildId?: string;
}

export function readUpdateIdentity(
  resources: Pick<DesktopResources, "packaged" | "identity">,
  env: Readonly<Record<string, string | undefined>> = process.env,
  readText: (path: string) => string | null = textOf,
): UpdateIdentity | null {
  if (!resources.packaged || resources.identity === null) return null;
  const raw = readText(resources.identity.identityPath);
  if (raw === null) return null;
  let parsed: ReturnType<typeof StagedReleaseIdentity.safeParse>;
  try {
    parsed = StagedReleaseIdentity.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const identity = parsed.data;
  const override = env[UPDATE_ORIGIN_OVERRIDE_ENV];
  const useOverride =
    identity.keyClass === "dev" && typeof override === "string" && override.length > 0;
  return {
    origin: useOverride ? override : identity.updateOrigin,
    channel: identity.updateChannel,
    rootKeys: identity.trustRootKeys,
    keyClass: identity.keyClass,
    originOverridden: useOverride,
    floors:
      identity.updateFloors === undefined
        ? NOTHING_REMEMBERED
        : {
            trustRoot: identity.updateFloors.trustRoot,
            channels: identity.updateFloors.channels,
            policy: {
              nightly: identity.updateFloors.policy.nightly,
              beta: identity.updateFloors.policy.beta,
              stable: identity.updateFloors.policy.stable,
            },
          },
    ...(identity.buildId !== undefined ? { buildId: identity.buildId } : {}),
  };
}

function textOf(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
