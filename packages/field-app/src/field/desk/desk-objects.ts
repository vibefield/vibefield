import { Calendar, DESK_OBJECTS } from "@vibecook/ice/desk/objects";

// VibeField's active built-ins. The engine keeps the calendar implementation for other hosts.
export const FIELD_DESK_OBJECTS = DESK_OBJECTS.filter((object) => object !== Calendar);

// Old calendar rows and their entries stay readable and recoverable, without mounting a kind,
// driver, print service, input handler, or tray specimen in this app.
export const RETIRED_DESK_OBJECTS = [Calendar] as const;
