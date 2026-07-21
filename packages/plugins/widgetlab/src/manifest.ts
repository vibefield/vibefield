import type { PluginManifest } from "@vibefield/plugin-runtime";

// The widgetlab demo pack (Track D3): the eight iOS-style DOM cards ported
// verbatim from infinite-canvas-engine/apps/widgetlab — the SDK dogfood
// (thinking-widgetlab-port §1: if the plugin system can express these, the
// API is right). Sizes are the iOS presets (155/329 grid, DESIGN.md §4).
// `preview` literals mirror each card's exported surface constant (the tray
// and folder-mini silhouette fallback; weather = WEATHER_GRADIENT, photos =
// the representative sunset from widgetlab preview.ts).

export const widgetlabManifest: PluginManifest = {
  id: "widgetlab",
  version: "0.1.0",
  title: "Widgetlab",
  widgets: [
    {
      type: "widgetlab.clock",
      title: "Clock",
      defaultSize: { w: 155, h: 155 },
      description: "Analog clock with a live second hand",
      category: "Cards",
    },
    {
      type: "widgetlab.battery",
      title: "Battery",
      defaultSize: { w: 155, h: 155 },
      description: "Battery ring",
      category: "Cards",
    },
    {
      type: "widgetlab.calendar",
      title: "Calendar",
      defaultSize: { w: 155, h: 155 },
      description: "Today + the next event",
      category: "Cards",
      preview: "#ffffff", // the one light card
    },
    {
      type: "widgetlab.weather",
      title: "Weather",
      defaultSize: { w: 329, h: 155 },
      description: "Temperature, hi/lo, condition glyph",
      category: "Cards",
      preview: "linear-gradient(135deg, #3A86FF 0%, #1D4ED8 55%, #0B2AB5 100%)", // WEATHER_GRADIENT
    },
    {
      type: "widgetlab.stocks",
      title: "Stocks",
      defaultSize: { w: 329, h: 155 },
      description: "Tickers with sparklines",
      category: "Cards",
      preview: "#000000", // the deep data surface (StocksCard bg-black)
    },
    {
      type: "widgetlab.fitness",
      title: "Fitness",
      defaultSize: { w: 329, h: 345 },
      description: "Activity rings",
      category: "Cards",
      preview: "#000000", // deep data surface (bg-black)
    },
    {
      type: "widgetlab.photos",
      title: "Photos",
      defaultSize: { w: 329, h: 535 },
      description: "A photo stack",
      category: "Cards",
      // Photos art is hue-randomized SVG per instance; a representative sunset.
      preview: "linear-gradient(135deg, #FF9E5E 0%, #E0526E 55%, #33204A 100%)",
    },
    {
      type: "widgetlab.todo",
      title: "To-do",
      defaultSize: { w: 329, h: 345 },
      description: "Checklist",
      category: "Cards",
      preview: "#000000", // deep data surface (bg-black)
    },
  ],
  scopes: [], // pure-canvas demo pack: no fabric access
};
