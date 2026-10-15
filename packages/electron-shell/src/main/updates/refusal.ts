// WP12b — a verification refusal, thrown out of the provider's `getLatestVersion` so electron-updater stops BEFORE
// any download; the controller maps it to `UNAVAILABLE {service: "updates", state}` (TD-3). Its own module so the
// controller recognizes it without importing electron-updater.

import type { UpdatesUnavailableState } from "@vibefield/contracts";

export class UpdateRefusal extends Error {
  readonly code = "ERR_VF_UPDATES_REFUSED";
  constructor(
    readonly state: UpdatesUnavailableState,
    readonly detail: string,
  ) {
    super(`updates/${state}: ${detail}`);
    this.name = "UpdateRefusal";
  }
}
