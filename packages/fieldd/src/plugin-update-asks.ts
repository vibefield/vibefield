import type { PluginRecord } from "@vibefield/contracts";

// MK-UC (2026-11-14; James's pick on the board, 2026-11-12 06:08:01Z: "Yes: show the card when
// an update asks for more"): what an update asks for that the version you have does not. fieldd
// reads it at prepare, from two rows the registry builds the same way (`plugin-registry.ts`,
// `buildRow`): the installed row, and the candidate's, held to the manifest inside the bytes the
// signed list pins (MK-O2). The update card lists these powers alone, and plugins.install's one
// press refuses an update that has any, so no road skips the card. The card's Update reads the
// candidate's row again and holds it to what the card was read against (`updateCardMoved`; the
// review's fix, 2026-11-14).

/** plugins.install's refusal of an update that can do more than the version you have: its reason
 * code, in the error's details, as `COMMUNITY_SWITCH_CLOSED` is (`plugin-install.ts`). */
export const UPDATE_ASKS_MORE = "UPDATE_ASKS_MORE";

/** The two fields of a row the compare reads, and no other. */
export type RowPowers = Pick<PluginRecord, "requestedCapabilities" | "deniedCapabilities">;

/** The powers a row could use: what its manifest asks for, less each one it is denied here,
 * whatever the reason (an entry that cannot use it, or a power the person turned off on this
 * desktop). It is read the same way for a row that is on, off or held, so neither `enabled` nor
 * `grantedCapabilities` enters it: an off or held row grants nothing, and would count every
 * power. */
export function usablePowers(row: RowPowers): string[] {
  const denied = new Set(row.deniedCapabilities.map((entry) => entry.capability));
  return [...new Set(row.requestedCapabilities)].filter((power) => !denied.has(power));
}

/** What the update could use that the installed version could not, in the update's own order: the
 * update card's new powers.
 * - A power the person turned off stays off. The decision is kept by the power's id
 *   (`install-records.json`), so the update's row is denied it too, and it is not counted.
 * - A power the installed version asked for and could not use for its entry, which the update's new
 *   entry can, is counted: the plugin can do more.
 * - Objects and tools are not counted: the Updates row says what an update adds and removes.
 * - A plugin's own power whose declaration changed under the same id (its title or its risk) is not
 *   counted. It is said, not built. */
export function updateAsksFor(installed: RowPowers, update: RowPowers): string[] {
  const before = new Set(usablePowers(installed));
  return usablePowers(update).filter((power) => !before.has(power));
}

/** An update card's Update refused because its plugin changed while the card waited: its reason
 * code, in the error's details, as `UPDATE_ASKS_MORE` is. */
export const UPDATE_CARD_MOVED = "UPDATE_CARD_MOVED";

/** What an update's card was read against, held with it until its Update or Cancel: the version
 * you have (the installed row's install revision and manifest hash at prepare) and the powers the
 * card named. */
export interface UpdateCardBasis {
  readonly installRevision: string;
  readonly manifestHash: string;
  readonly asksFor: readonly string[];
}

/** The fields of the installed row the check reads. */
export type CardRow = Pick<PluginRecord, "installRevision" | "manifestHash"> & RowPowers;

/** Why an update card's Update must change nothing, or null while the card still holds. The Update
 * can come fifteen minutes after the download, so the caller reads the candidate's row again from
 * the same folder and the records as they stand then (`fresh`), and holds it to the card:
 * - "version": the version you have is not the one the card was read against;
 * - "files": the candidate's manifest is not the one inside the bytes the signed list pins;
 * - "asks": the update can now do something the card did not name.
 * Anything else that moved while it waited (a power turned off, the plugin turned off or on) is in
 * the fresh row, and the card still holds. */
export function updateCardMoved(
  card: UpdateCardBasis,
  live: CardRow | undefined,
  fresh: Pick<PluginRecord, "manifestHash"> & RowPowers,
  pinnedManifestHash: string,
): "version" | "files" | "asks" | null {
  if (
    live === undefined ||
    live.installRevision !== card.installRevision ||
    live.manifestHash !== card.manifestHash
  )
    return "version";
  if (fresh.manifestHash !== pinnedManifestHash) return "files";
  const named = new Set(card.asksFor);
  return updateAsksFor(live, fresh).some((power) => !named.has(power)) ? "asks" : null;
}
