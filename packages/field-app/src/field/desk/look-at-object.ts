import type { Entity } from "@vibecook/ice";
import { getActiveView, requestView } from "../../frame/view-state";
import { currentDesk, type MountedDesk } from "./desk-door";

/**
 * THE ONE DOOR TO AN OBJECT ON THE DESK (thinking-objects-at-work.md §4.4 and §7; OB-D16, 2026-11-25): the person's eye
 * taken to it, and it selected. A ref card played on the desk comes here, and so does a sticker clicked in a Godview
 * pane. It is ICE's `ops.lookAt` (petition I58, ICE 0.21.0; the EL8 of 2026-11-25) at its defaults: the camera flies
 * to the object and centres it, keeping the zoom the person is at where the object reads and fits there (else in to
 * a zoom it reads at, or out until it fits); an object inside a mini mat is reached in its own frame; the selection
 * becomes the object alone. Reduced motion snaps. False, with nothing changed: nothing to look at (the object is
 * gone or is no object of the scene, or the desk has no viewport yet).
 */
export function lookAtObject(desk: MountedDesk, entity: Entity): boolean {
  return desk.engine.ops.lookAt(entity);
}

/** Where an at-work row says the object is: its board and its durable key there. */
export interface DeskPlace {
  readonly docId: string;
  readonly key: string;
}

export interface ShowOnDeskDeps {
  readonly requestView?: typeof requestView;
  readonly activeView?: typeof getActiveView;
  readonly desk?: () => MountedDesk | null;
  /** one frame, so the cover's thaw has run before the camera moves */
  readonly settle?: () => Promise<void>;
}

const nextFrame = (): Promise<void> =>
  new Promise((done) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => done());
    else setTimeout(done, 0);
  });

/**
 * A sticker's click (OB-D16, touch A): Canvas comes forward, then the object is looked at. False when Canvas did not
 * come, or the object is on a board this window has not mounted, or it is gone.
 */
export async function showOnDesk(place: DeskPlace, deps: ShowOnDeskDeps = {}): Promise<boolean> {
  const activeView = deps.activeView ?? getActiveView;
  if (activeView() !== "canvas") await (deps.requestView ?? requestView)("canvas");
  if (activeView() !== "canvas") return false;
  await (deps.settle ?? nextFrame)();
  const desk = (deps.desk ?? currentDesk)();
  if (desk === null || desk.docId !== place.docId) return false;
  const entity = desk.engine.docs.current()?.store.resolve(place.key as never) as
    | Entity
    | undefined;
  return entity !== undefined && lookAtObject(desk, entity);
}
