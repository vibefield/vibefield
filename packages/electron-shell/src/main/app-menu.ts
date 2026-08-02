import { Menu, type MenuItemConstructorOptions } from "electron";
import {
  type AppMenuActions,
  type AppMenuItem,
  type AppMenuState,
  buildAppMenu,
  type MenuPlatform,
} from "./app-menu-model";

// The Electron adapter for app-menu-model (tray-native's shape): translate the
// template, hand it to Menu, and hold nothing. Every decision — which items
// exist, which accelerator is live, what the checkmark says — was made in the
// pure module and is tested there.

function template(items: readonly AppMenuItem[]): MenuItemConstructorOptions[] {
  return items.map((item) => ({
    // exactOptionalPropertyTypes: an explicit `undefined` is not the same as an
    // absent key to Electron's builder, so every optional is spread or omitted.
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(item.role !== undefined
      ? { role: item.role as NonNullable<MenuItemConstructorOptions["role"]> }
      : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
    ...(item.label !== undefined ? { label: item.label } : {}),
    ...(item.accelerator !== undefined ? { accelerator: item.accelerator } : {}),
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.click !== undefined ? { click: item.click } : {}),
    ...(item.submenu !== undefined ? { submenu: template(item.submenu) } : {}),
  }));
}

/** Install the application menu, and hand back the way to redraw it.
 *
 * A redraw rather than a mutation: the accelerator on the close item exists or
 * does not exist depending on the overlay, and Electron binds accelerators when
 * the menu is SET. Rebuilding is how the binding actually changes; poking
 * `menuItem.checked` alone would leave ⌘W wherever it was. */
export function installAppMenu(
  platform: MenuPlatform,
  actions: AppMenuActions,
): (state: AppMenuState) => void {
  const apply = (state: AppMenuState): void => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(template(buildAppMenu(platform, state, actions))),
    );
  };
  apply({ godviewOpen: false });
  return apply;
}
