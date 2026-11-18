import type { Entity, World } from "@vibefield/plugin-sdk/desk";
import type { PaneSettingsApi } from "./device";

export interface PaneMenuHost {
  configure(api: PaneSettingsApi, entities: readonly Entity[]): void;
  say(message: string): void;
}
const menus = new WeakMap<World, PaneMenuHost>();
export const paneMenuOf = (world: World): PaneMenuHost | undefined => menus.get(world);
export function bindPaneMenu(world: World, menu: PaneMenuHost | undefined): void {
  if (menu === undefined) menus.delete(world);
  else menus.set(world, menu);
}
