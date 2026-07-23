/** Explicit smoke/development console adapter. Production evidence uses the
 * renderer MessagePort; this marker remains solely because the headless canvas
 * smoke harness observes renderer console output as its pass condition. */
export function emitCanvasReadyMarker(widgetTypes: number, plugins: number): void {
  console.log(`CANVAS_READY {"widgetTypes":${widgetTypes},"plugins":${plugins}}`);
}
