import { Calendar, DESK_OBJECTS, Notebook } from "@vibecook/ice/desk/objects";

// VibeField's active built-ins. The engine keeps the calendar's and the notebook's implementations for other hosts.
export const FIELD_DESK_OBJECTS = DESK_OBJECTS.filter(
  (object) => object !== Calendar && object !== Notebook,
);

// Old calendar rows with their entries, and old notebooks (retired 2026-11-09, James, the first launch's lineup), stay
// readable and recoverable, without mounting a kind, driver, print service, input handler, or tray specimen in this app.
export const RETIRED_DESK_OBJECTS = [Calendar, Notebook] as const;
