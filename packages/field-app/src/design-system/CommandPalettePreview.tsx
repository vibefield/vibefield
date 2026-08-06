import { type KeyboardEvent, type ReactElement, useMemo, useState } from "react";
import { CommandPaletteView, type PaletteCommand } from "../hud/CommandPalette";

const PREVIEW_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "note.create",
    title: "Add note",
    description: "Create a writing card on the field",
    pluginId: "note",
    pluginTitle: "Notes",
    available: true,
  },
  {
    id: "artifact.open",
    title: "Open Artifact Hub",
    description: "Browse shared proxies and folders",
    pluginId: "browser",
    pluginTitle: "Browser",
    available: true,
  },
  {
    id: "repository.open",
    title: "Open repository",
    description: "Open the selected repository",
    pluginId: "repository",
    pluginTitle: "Repository",
    available: false,
  },
];

/** Runtime-free adapter around the production command-palette composition. */
export function CommandPalettePreview(): ReactElement {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return PREVIEW_COMMANDS;
    return PREVIEW_COMMANDS.filter((command) =>
      `${command.title} ${command.pluginTitle}`.toLowerCase().includes(needle),
    );
  }, [query]);
  const available = matched.filter((command) => command.available);
  const activeId = available[Math.min(activeIndex, Math.max(0, available.length - 1))]?.id;

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (available.length === 0 ? 0 : (index + 1) % available.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        available.length === 0 ? 0 : (index - 1 + available.length) % available.length,
      );
    }
  };

  return (
    <CommandPaletteView
      visible
      query={query}
      commands={PREVIEW_COMMANDS}
      matched={matched}
      {...(activeId === undefined ? {} : { activeId })}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setActiveIndex(0);
      }}
      onInputKeyDown={onInputKeyDown}
      onRun={() => undefined}
      onClose={() => undefined}
    />
  );
}
