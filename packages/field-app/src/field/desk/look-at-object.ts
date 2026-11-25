import { Camera, type Entity, Position, Size, Viewport } from "@vibecook/ice";
import { getActiveView, requestView } from "../../frame/view-state";
import { currentDesk, type MountedDesk } from "./desk-door";

/**
 * THE ONE DOOR TO AN OBJECT ON THE DESK (thinking-objects-at-work.md §4.4 and §7; OB-D16, 2026-11-25): the person's eye
 * taken to it — its centre at the view's centre, at the zoom they are at — and it selected. A ref card played on the
 * desk comes here, and so does a sticker clicked in a Godview pane. ICE petition I58 adds `ops.lookAt`, which flies
 * there, keeps a zoom the object reads at and reaches an object inside a mini mat; the EL8 that brings it changes this
 * door alone. Until then it moves the camera at once, as the card door always has. False: nothing to look at.
 */
export function lookAtObject(desk: MountedDesk, entity: Entity): boolean {
  const { engine } = desk;
  const at = engine.world.get(entity, Position);
  const size = engine.world.get(entity, Size);
  const view = engine.world.getResource(Viewport);
  const camera = engine.world.getResource(Camera);
  if (at === undefined || size === undefined || view === undefined || camera === undefined)
    return false;
  engine.ops.panTo(
    at.x + size.w / 2 - view.w / (2 * camera.zoom),
    at.y + size.h / 2 - view.h / (2 * camera.zoom),
  );
  engine.ops.setSelection([entity]);
  return true;
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
