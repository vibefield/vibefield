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
    // --- the 3D shelf (GL islands over CardShell backplates; previews mirror
    // each card's exported BACKPLATE through gradientCss, or the glassy
    // GL-floating fill for the chromeless pair) ---
    {
      type: "widgetlab.sphere",
      title: "Sphere",
      defaultSize: { w: 155, h: 155 },
      description: "A matte sphere",
      category: "3D",
      preview: "linear-gradient(135deg, #FFB6C1 0%, #FF7E8A 55%, #C24A6B 100%)",
    },
    {
      type: "widgetlab.crystal",
      title: "Crystal",
      defaultSize: { w: 155, h: 155 },
      description: "A floating crystal — chromeless island",
      category: "3D",
      preview: "rgba(165, 175, 225, 0.18)",
    },
    {
      type: "widgetlab.torus-knot",
      title: "Torus knot",
      defaultSize: { w: 329, h: 155 },
      description: "A spinning torus knot",
      category: "3D",
      preview: "linear-gradient(135deg, #2D1B5E 0%, #1A1240 55%, #0A0820 100%)",
    },
    {
      type: "widgetlab.cube",
      title: "Cube",
      defaultSize: { w: 329, h: 155 },
      description: "A floating rounded cube — chromeless island",
      category: "3D",
      preview: "rgba(165, 175, 225, 0.18)",
    },
    {
      type: "widgetlab.gold-knot",
      title: "Gold knot",
      defaultSize: { w: 329, h: 345 },
      description: "A gilded knot",
      category: "3D",
      preview: "linear-gradient(135deg, #4A2814 0%, #2A0E12 60%, #14080C 100%)",
    },
    {
      type: "widgetlab.shapes",
      title: "Shapes",
      defaultSize: { w: 329, h: 345 },
      description: "A repelling shape swarm — drag inside it",
      category: "3D",
      preview: "linear-gradient(135deg, #1F2333 0%, #14161F 60%, #0A0B12 100%)",
    },
    {
      type: "widgetlab.orbit-cube",
      title: "Orbit cube",
      defaultSize: { w: 329, h: 155 },
      description: "Drag the cube itself — the mesh claims the gesture",
      category: "3D",
      preview: "linear-gradient(135deg, #102030 0%, #050a14 100%)",
    },
    // --- the node trio (wire-able: ports accept "signal"; previews = NODE_BG) ---
    {
      type: "widgetlab.signal",
      title: "Signal",
      defaultSize: { w: 170, h: 96 },
      description: "A source node — one out port",
      category: "Nodes",
      preview: "#1C2540",
    },
    {
      type: "widgetlab.filter",
      title: "Filter",
      defaultSize: { w: 170, h: 96 },
      description: "A transform node — in and out",
      category: "Nodes",
      preview: "#1F3327",
    },
    {
      type: "widgetlab.scope",
      title: "Scope",
      defaultSize: { w: 170, h: 96 },
      description: "A sink node — two inputs",
      category: "Nodes",
      preview: "#33231C",
    },
  ],
  scopes: [], // pure-canvas demo pack: no fabric access
};
