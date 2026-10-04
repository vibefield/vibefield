// The desk clock's IDS — durable: its type lives in boards, its act in an app's keys. Pure (no import),
// so the manifest's emit (plain Node, before any bundle exists) and the kind read the same strings.

/** The clock's durable type id — namespaced by its plugin, as every plugin's ids are (`<pluginId>`). */
export const CLOCK_TYPE = "vibefield.example.desk-clock";

/**
 * The clock's KIND name — its key in the desk's registry, in every slot's objects and in
 * `handle.local(…)`. The host's rule (DK-6 input (b)): a kind's registry name IS its type, one id and no
 * second namespace to collide in (ICE's own example names its kind `desk-clock` beside a type of its
 * package's; a VibeField kind cannot).
 */
export const CLOCK_KIND = CLOCK_TYPE;

/** Its selection-menu act (`ops.runMenuAction`): the seconds hand on or off. */
export const CLOCK_SECONDS_ACT = "desk-clock.seconds";
