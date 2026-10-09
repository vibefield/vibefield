// The faces the pane's stills show (PT-2 — the playground's `--still` lends ICE's `stillLive` over this under `LIVE`): a web
// page's face is the SAMPLE web's landing page — this plugin's own bytes (sample-page.ts), laid out at the face's viewport in
// its scheme — so a still draws a live pane through its LIVE path (the face's texture, its sampling, its mips), never a third
// party's pixels and never a producer. Its logical size: the page's CSS viewport, as a live page's frames say theirs. Its words:
// the page's address as the spec names it.
//
// Authoring-time only, as states.ts is: this directory never enters a `.vfplugin`.
import { liveBrowserSpec } from "@vibefield/plugin-sdk/desk";
import { pageTexels, samplePage } from "../src/sample-page";

export default (_key: string, spec: Readonly<Record<string, unknown>>) => {
  const page = liveBrowserSpec(spec);
  if (page === undefined) return undefined;
  const [width, height] = pageTexels(page.viewport);
  return {
    width,
    height,
    bytes: samplePage(page.viewport, page.scheme, [width, height]),
    logical: page.viewport,
    info: { address: page.url },
  };
};
