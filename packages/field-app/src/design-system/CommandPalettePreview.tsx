import type { FrameView } from "@vibefield/contracts";
import { type KeyboardEvent, type ReactElement, useMemo, useState } from "react";
import { frameActGroups } from "../frame/palette-acts";
import type { ViewKeys } from "../frame/views";
import { CommandPaletteView, filterPalette, type PaletteGroup } from "../hud/CommandPalette";

// The palette's fixture ADAPTER (One Frame FR-3, §7): the production view on
// the frame's own acts — built by the product's table for the view — and two
// fixture plugins' commands, one of them declared with no live handler. What
// running a row does is the controller's; here a row is only pointed at.

const FIXTURE_COMMANDS: readonly PaletteGroup[] = [
  {
    id: "plugin:note",
    eyebrow: "Notes",
    rows: [
      {
        id: "note.create",
        name: "Add note",
        glyph: "plugin",
        key: null,
        sub: "Create a writing card on the field",
        waits: null,
      },
    ],
  },
  {
    id: "plugin:repository",
    eyebrow: "Repository",
    rows: [
      {
        id: "repository.open",
        name: "Open repository",
        glyph: "plugin",
        key: null,
        sub: "Open the selected repository",
        waits: "unavailable",
      },
    ],
  },
];

/** Runtime-free adapter around the production command-palette composition. */
export function CommandPalettePreview({
  view = "canvas",
  keys = "mac",
}: {
  view?: FrameView;
  keys?: ViewKeys;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [hot, setHot] = useState<string | null>(null);
  const groups = useMemo<PaletteGroup[]>(
    () => [
      ...frameActGroups(view, keys).map((group) => ({
        id: group.id,
        eyebrow: group.eyebrow,
        rows: group.acts.map((act) => ({
          id: act.id,
          name: act.name,
          glyph: act.glyph,
          key: act.key,
          waits: act.waits,
          ...(act.terms === undefined ? {} : { terms: act.terms }),
        })),
      })),
      ...FIXTURE_COMMANDS,
    ],
    [view, keys],
  );
  const matched = useMemo(() => filterPalette(groups, query), [groups, query]);
  const walk = matched.flatMap((group) => group.rows.filter((row) => row.waits === null));
  const hotId = walk.some((row) => row.id === hot) ? (hot ?? undefined) : walk[0]?.id;

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (walk.length === 0) return;
    const at = walk.findIndex((row) => row.id === hotId);
    const next =
      event.key === "ArrowDown" ? (at + 1) % walk.length : (at - 1 + walk.length) % walk.length;
    setHot(walk[next]?.id ?? null);
  };

  return (
    <CommandPaletteView
      visible
      query={query}
      groups={matched}
      {...(hotId === undefined ? {} : { hotId })}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setHot(null);
      }}
      onInputKeyDown={onInputKeyDown}
      onRun={() => undefined}
      onHot={setHot}
      onClose={() => undefined}
    />
  );
}
