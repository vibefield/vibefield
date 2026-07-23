import type { JsonShape, PluginManifestV1 } from "@vibefield/contracts";

// The widgetlab demo pack (Track D3): the eighteen iOS-style DOM/GL/node cards
// ported verbatim from infinite-canvas-engine/apps/widgetlab — the SDK dogfood
// (thinking-widgetlab-port §1: if the plugin system can express these, the API
// is right). Sizes are the iOS presets (155/329 grid, DESIGN.md §4). widgetlab
// stays the dev alias until C2 ratifies a durable id (P-2: the TYPE strings
// are forever — they live in boards).
//
// C1b·2 — canonical V1: the retired defineWidget calls verbatim (props/sizes/
// interaction/ports/provides). `sizeMode` is "fixed" for every widget below —
// the 8 DOM cards never set it in their hand call, and "fixed" IS
// defineWidget's own default (ice's define-widget.ts), so this is not a
// behavior change; said once here rather than per widget. Previews are
// SafePreview; the two chromeless GL islands (crystal, cube) carried a raw
// rgba() fill in the legacy manifest that SafePreview's color/gradient union
// cannot express (color is hex-only, gradient requires a linear-/radial-
// gradient() function) — DROPPED rather than coerced (§8.2: raw CSS from
// manifests died with the legacy WidgetDecl), noted at each of the two entries.

/** The {current, goal} shape shared by fitness's move/exercise/stand props
 * (FitnessCard.tsx's retired `goalShape`, used three times there too). */
const GOAL_SHAPE: JsonShape = {
  kind: "object",
  fields: { current: { kind: "number" }, goal: { kind: "number" } },
};

export const widgetlabManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "widgetlab",
  version: "0.1.0",
  title: "Widgetlab",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [
    "onWidget:widgetlab.clock",
    "onWidget:widgetlab.battery",
    "onWidget:widgetlab.calendar",
    "onWidget:widgetlab.weather",
    "onWidget:widgetlab.stocks",
    "onWidget:widgetlab.fitness",
    "onWidget:widgetlab.photos",
    "onWidget:widgetlab.todo",
    "onWidget:widgetlab.sphere",
    "onWidget:widgetlab.crystal",
    "onWidget:widgetlab.torus-knot",
    "onWidget:widgetlab.cube",
    "onWidget:widgetlab.gold-knot",
    "onWidget:widgetlab.shapes",
    "onWidget:widgetlab.orbit-cube",
    "onWidget:widgetlab.signal",
    "onWidget:widgetlab.filter",
    "onWidget:widgetlab.scope",
  ],
  capabilities: [], // pure-canvas demo pack: no fabric access
  contributes: {
    widgets: [
      {
        type: "widgetlab.clock",
        title: "Clock",
        description: "Analog clock with a live second hand",
        category: "Cards",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 155, h: 155 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          timezone: { kind: "string", default: "local" },
        },
        groups: {},
      },
      {
        type: "widgetlab.battery",
        title: "Battery",
        description: "Battery ring",
        category: "Cards",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 155, h: 155 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          phone: { kind: "number", default: 82, min: 0, max: 100 },
          watch: { kind: "number", default: 47, min: 0, max: 100 },
          airpods: { kind: "number", default: 91, min: 0, max: 100 },
        },
        groups: {},
      },
      {
        type: "widgetlab.calendar",
        title: "Calendar",
        description: "Today + the next event",
        category: "Cards",
        preview: { kind: "color", value: "#ffffff" }, // the one light card
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 155, h: 155 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          dateIso: { kind: "string", default: "" },
          nextEvent: { kind: "string", default: "Design review" },
          nextEventTime: { kind: "string", default: "3:30 PM" },
        },
        groups: {},
      },
      {
        type: "widgetlab.weather",
        title: "Weather",
        description: "Temperature, hi/lo, condition glyph",
        category: "Cards",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #3A86FF 0%, #1D4ED8 55%, #0B2AB5 100%)",
        }, // WEATHER_GRADIENT
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 155 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          location: { kind: "string", default: "San Francisco" },
          temp: { kind: "number", default: 64 },
          high: { kind: "number", default: 68 },
          low: { kind: "number", default: 58 },
          condition: {
            kind: "enum",
            options: ["sunny", "cloudy", "partly-cloudy", "rainy"],
            default: "partly-cloudy",
          },
        },
        groups: {},
      },
      {
        type: "widgetlab.stocks",
        title: "Stocks",
        description: "Tickers with sparklines",
        category: "Cards",
        preview: { kind: "color", value: "#000000" }, // the deep data surface (StocksCard bg-black)
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 155 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          tickers: {
            kind: "json",
            inner: {
              kind: "array",
              item: {
                kind: "object",
                fields: {
                  symbol: { kind: "string" },
                  price: { kind: "number" },
                  changePct: { kind: "number" },
                  history: { kind: "array", item: { kind: "number" } },
                },
              },
            },
            default: [
              {
                symbol: "AAPL",
                price: 218.54,
                changePct: 2.14,
                history: [210, 211, 214, 213, 216, 215, 217, 218, 217, 218.54],
              },
              {
                symbol: "TSLA",
                price: 241.02,
                changePct: -1.32,
                history: [252, 249, 247, 246, 244, 243, 241, 242, 240, 241.02],
              },
              {
                symbol: "NVDA",
                price: 872.3,
                changePct: 4.72,
                history: [820, 828, 835, 840, 846, 855, 860, 865, 870, 872.3],
              },
            ],
          },
        },
        groups: {},
      },
      {
        type: "widgetlab.fitness",
        title: "Fitness",
        description: "Activity rings",
        category: "Cards",
        preview: { kind: "color", value: "#000000" }, // deep data surface (bg-black)
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 345 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          move: { kind: "json", inner: GOAL_SHAPE, default: { current: 420, goal: 520 } },
          exercise: { kind: "json", inner: GOAL_SHAPE, default: { current: 22, goal: 30 } },
          stand: { kind: "json", inner: GOAL_SHAPE, default: { current: 9, goal: 12 } },
        },
        groups: {},
      },
      {
        type: "widgetlab.photos",
        title: "Photos",
        description: "A photo stack",
        category: "Cards",
        // Photos art is hue-randomized SVG per instance; a representative sunset.
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #FF9E5E 0%, #E0526E 55%, #33204A 100%)",
        },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 535 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          badge: { kind: "string", default: "ON THIS DAY" },
          yearsAgo: { kind: "number", default: 4 },
          title: { kind: "string", default: "Sunset over Point Reyes" },
          location: { kind: "string", default: "California · April 21" },
          hue: { kind: "number", default: 18, min: 0, max: 360 },
        },
        groups: {},
      },
      {
        type: "widgetlab.todo",
        title: "To-do",
        description: "Checklist",
        category: "Cards",
        preview: { kind: "color", value: "#000000" }, // deep data surface (bg-black)
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 345 },
        interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
        provides: ["widget"],
        props: {
          title: { kind: "string", default: "Today" },
          items: {
            kind: "json",
            inner: {
              kind: "array",
              item: {
                kind: "object",
                fields: {
                  id: { kind: "string" },
                  text: { kind: "string" },
                  done: { kind: "boolean" },
                },
              },
            },
            default: [
              { id: "1", text: "Ship RFC-006", done: true },
              { id: "2", text: "Audit pointer router", done: true },
              { id: "3", text: "Test in playground", done: false },
              { id: "4", text: "Document author contract", done: false },
            ],
          },
        },
        groups: {},
      },
      // --- the 3D shelf (GL islands over CardShell backplates; previews mirror
      // each card's exported BACKPLATE through gradientCss, or DROPPED for the
      // chromeless pair — see the header note) ---
      {
        type: "widgetlab.sphere",
        title: "Sphere",
        description: "A matte sphere",
        category: "3D",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #FFB6C1 0%, #FF7E8A 55%, #C24A6B 100%)",
        },
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 155, h: 155 },
        minSize: { w: 120, h: 120 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          color: { kind: "string", default: "#F5B8D0" },
        },
        groups: {},
      },
      {
        type: "widgetlab.crystal",
        title: "Crystal",
        description: "A floating crystal — chromeless island",
        category: "3D",
        // legacy preview was rgba(165, 175, 225, 0.18) — the chromeless-pair
        // glassy GL-floating fill. SafePreview's color arm is hex-only and its
        // gradient arm requires a linear-/radial-gradient() function, so
        // neither can express a raw rgba(). DROPPED (see header note).
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 155, h: 155 },
        minSize: { w: 120, h: 120 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          tint: { kind: "string", default: "#9AE5FF" },
        },
        groups: {},
      },
      {
        type: "widgetlab.torus-knot",
        title: "Torus knot",
        description: "A spinning torus knot",
        category: "3D",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #2D1B5E 0%, #1A1240 55%, #0A0820 100%)",
        },
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 155 },
        minSize: { w: 200, h: 120 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          hue: { kind: "number", default: 285, min: 0, max: 360 },
        },
        groups: {},
      },
      {
        type: "widgetlab.cube",
        title: "Cube",
        description: "A floating rounded cube — chromeless island",
        category: "3D",
        // legacy preview was rgba(165, 175, 225, 0.18) — same chromeless-pair
        // fill as crystal; DROPPED for the same reason (see header note).
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 155 },
        minSize: { w: 200, h: 120 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          color: { kind: "string", default: "#E8523B" },
        },
        groups: {},
      },
      {
        type: "widgetlab.gold-knot",
        title: "Gold knot",
        description: "A gilded knot",
        category: "3D",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #4A2814 0%, #2A0E12 60%, #14080C 100%)",
        },
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 345 },
        minSize: { w: 240, h: 200 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          metal: { kind: "enum", options: ["gold", "chrome", "copper"], default: "gold" },
        },
        groups: {},
      },
      {
        type: "widgetlab.shapes",
        title: "Shapes",
        description: "A repelling shape swarm — drag inside it",
        category: "3D",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #1F2333 0%, #14161F 60%, #0A0B12 100%)",
        },
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 345 },
        minSize: { w: 240, h: 200 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          accentIdx: { kind: "number", default: 0, min: 0, max: 3 },
        },
        groups: {},
      },
      {
        type: "widgetlab.orbit-cube",
        title: "Orbit cube",
        description: "Drag the cube itself — the mesh claims the gesture",
        category: "3D",
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, #102030 0%, #050a14 100%)",
        },
        schemaVersion: 1,
        surface: "gl",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 155 },
        minSize: { w: 200, h: 120 },
        interaction: {
          solid: true,
          dragOn: "press",
          selectable: true,
          movable: true,
          snap: "both",
        },
        provides: ["widget"],
        props: {
          hue: { kind: "number", default: 200, min: 0, max: 360 },
        },
        groups: {},
      },
      // --- the node trio (wire-able: ports accept "signal"; previews = NODE_BG) ---
      {
        type: "widgetlab.signal",
        title: "Signal",
        description: "A source node — one out port",
        category: "Nodes",
        preview: { kind: "color", value: "#1C2540" },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 170, h: 96 },
        minSize: { w: 140, h: 80 },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        provides: ["widget"],
        ports: [{ id: "out", side: "e", accepts: ["signal"] }],
        props: {
          hz: { kind: "number", default: 440, min: 1, max: 20000 },
        },
        groups: {},
      },
      {
        type: "widgetlab.filter",
        title: "Filter",
        description: "A transform node — in and out",
        category: "Nodes",
        preview: { kind: "color", value: "#1F3327" },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 170, h: 96 },
        minSize: { w: 140, h: 80 },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        provides: ["widget"],
        ports: [
          { id: "in", side: "w", accepts: ["signal"] },
          { id: "out", side: "e", accepts: ["signal"] },
        ],
        props: {
          mode: { kind: "enum", options: ["lowpass", "highpass", "bandpass"], default: "lowpass" },
        },
        groups: {},
      },
      {
        type: "widgetlab.scope",
        title: "Scope",
        description: "A sink node — two inputs",
        category: "Nodes",
        preview: { kind: "color", value: "#33231C" },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 170, h: 96 },
        minSize: { w: 140, h: 80 },
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        provides: ["widget"],
        ports: [
          { id: "in-a", side: "w", accepts: ["signal"] },
          { id: "in-b", side: "w", accepts: ["signal"] },
        ],
        props: {},
        groups: {},
      },
    ],
  },
};
