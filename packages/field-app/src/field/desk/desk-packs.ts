import { type DocSession, type DocVersionReport, gateVerdict } from "@vibecook/ice";
import { isDistributablePluginId } from "@vibefield/contracts";
import { typeDefinition } from "../../plugin-host/build-widget";

// A PACK LEARNED LIVE (DK-9; DK-5 input (2)'s other half): a live update can carry a pack marker this
// engine does not compile — a plugin's kind another desktop stamped while this one holds the board — and
// ICE's version gate holds a session read-only for it (its `newerInDoc`). Before DK-9 the board stayed
// read-only until it was reopened, since its ghost stubs are built per generation from the envelope. Now
// the ghost-stub path LEARNS the pack: the board reopens on a new generation (DocManager.remount), whose
// stubs, read off the board's envelope AS IT STANDS, include the new type at the doc's version — so the
// board stays writable, its objects of the type wearing the missing face. No ICE ask: a remount carries
// it (I25). A pack this realm cannot stub — a type it already defined, at another schema — is not
// learnable here; the board stays read-only and says why.

/** The packs a version report holds the board for that a remount's ghost stub can carry: distributable
 * plugin types this engine does not compile and this realm never defined. */
export function learnablePacks(report: DocVersionReport): string[] {
  return report.newerInDoc.filter(
    (type) =>
      isDistributablePluginId(type) &&
      report.localPacks[type] === undefined &&
      typeDefinition(type) === undefined,
  );
}

/**
 * Watch a session's live updates for a pack it must learn: once one holds the board (the gate no longer
 * `ok`) and every pack that holds it is learnable, `learn` is called — once; a hold that is not (a
 * newer schema of a type this realm defined) is `stuck`, said once.
 */
export function watchPacksLearned(
  session: DocSession,
  hooks: {
    readonly learn: (types: readonly string[]) => void;
    readonly stuck?: (types: readonly string[]) => void;
  },
): () => void {
  let said = false;
  return session.subscribeRemote(() => {
    if (said) return;
    const report = session.versionReport();
    if (gateVerdict(report) === "ok" || report.newerInDoc.length === 0) return;
    said = true;
    const learnable = learnablePacks(report);
    if (learnable.length === report.newerInDoc.length) hooks.learn(learnable);
    else hooks.stuck?.(report.newerInDoc.filter((type) => !learnable.includes(type)));
  });
}
