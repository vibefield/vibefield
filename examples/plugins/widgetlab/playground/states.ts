// Playground states (plugin spec §24.2) for the reference pack — the file other
// authors copy, so every declared widget appears even where one state is enough.
// See plugins/note/playground/states.ts for the shape and the authoring-time rule.
//
// The seven `gl` widgets are listed and are SKIPPED by the runner: a GL surface
// renders inside an island backed by a real WebGL context, which a headless DOM
// harness does not have. They are declared anyway so the intent is on record and
// the fixtures are already here when a GL-capable harness exists.
export default {
  // --- dom cards -----------------------------------------------------------
  "vibefield.widgetlab.clock": {
    default: { timezone: "local" },
    tokyo: { timezone: "Asia/Tokyo" },
  },
  "vibefield.widgetlab.battery": {
    default: { airpods: 91, phone: 82, watch: 47 },
    // The bounds of the declared 0..100 range, where the ring geometry is most
    // likely to degenerate.
    edges: { airpods: 0, phone: 100, watch: 1 },
  },
  "vibefield.widgetlab.calendar": {
    default: { dateIso: "", nextEvent: "Design review", nextEventTime: "3:30 PM" },
    // Every string prop empty: the card has to render a day with nothing on it.
    "nothing-scheduled": { dateIso: "2026-08-13", nextEvent: "", nextEventTime: "" },
  },
  "vibefield.widgetlab.weather": {
    default: {
      condition: "partly-cloudy",
      high: 68,
      location: "San Francisco",
      low: 58,
      temp: 64,
    },
    sunny: { condition: "sunny", high: 96, location: "Cupertino", low: 71, temp: 92 },
    rainy: { condition: "rainy", high: 41, location: "Reykjavík", low: 33, temp: 36 },
    // Below zero, and a location long enough to need truncation.
    freezing: {
      condition: "cloudy",
      high: -8,
      location: "Verkhoyansk, Sakha Republic",
      low: -47,
      temp: -31,
    },
  },
  "vibefield.widgetlab.stocks": {
    default: {
      tickers: [
        {
          symbol: "AAPL",
          price: 218.54,
          changePct: 2.14,
          history: [210, 211, 214, 213, 216, 215, 217, 218, 217, 218.54],
        },
        {
          symbol: "NVDA",
          price: 131.02,
          changePct: -1.37,
          history: [136, 135, 134, 133, 132, 133, 132, 131, 130, 131.02],
        },
      ],
    },
    // An empty list is what a real feed returns before it has answered.
    empty: { tickers: [] },
    "single-flat": {
      tickers: [{ symbol: "VF", price: 10, changePct: 0, history: [10, 10, 10, 10] }],
    },
  },
  "vibefield.widgetlab.fitness": {
    default: {
      exercise: { current: 22, goal: 30 },
      move: { current: 420, goal: 520 },
      stand: { current: 9, goal: 12 },
    },
    // Nothing done yet, and everything overshot — the two ends of a progress ring.
    untouched: {
      exercise: { current: 0, goal: 30 },
      move: { current: 0, goal: 520 },
      stand: { current: 0, goal: 12 },
    },
    exceeded: {
      exercise: { current: 61, goal: 30 },
      move: { current: 940, goal: 520 },
      stand: { current: 14, goal: 12 },
    },
  },
  "vibefield.widgetlab.photos": {
    default: {
      badge: "ON THIS DAY",
      hue: 18,
      location: "California · April 21",
      title: "Sunset over Point Reyes",
      yearsAgo: 4,
    },
    "hue-wrap": { badge: "", hue: 359, location: "", title: "Untitled", yearsAgo: 0 },
  },
  "vibefield.widgetlab.todo": {
    default: {
      title: "Today",
      items: [
        { id: "1", text: "Ship RFC-006", done: true },
        { id: "2", text: "Audit pointer router", done: true },
        { id: "3", text: "Test in playground", done: false },
        { id: "4", text: "Document author contract", done: false },
      ],
    },
    empty: { title: "Today", items: [] },
    "all-done": {
      title: "Shipped",
      items: [{ id: "1", text: "Everything", done: true }],
    },
  },
  "vibefield.widgetlab.signal": {
    default: { hz: 440 },
    // The declared 1..20000 bounds.
    edges: { hz: 1 },
    ultrasonic: { hz: 20000 },
  },
  "vibefield.widgetlab.filter": {
    default: { mode: "lowpass" },
    highpass: { mode: "highpass" },
    bandpass: { mode: "bandpass" },
  },
  // A node with no props at all — the fixture exists to say the empty case is
  // covered on purpose rather than forgotten.
  "vibefield.widgetlab.scope": { default: {} },

  // --- gl islands (skipped headlessly; declared for the record) -------------
  "vibefield.widgetlab.sphere": { default: { color: "#F5B8D0" } },
  "vibefield.widgetlab.crystal": { default: { tint: "#9AE5FF" } },
  "vibefield.widgetlab.torus-knot": { default: { hue: 285 } },
  "vibefield.widgetlab.cube": { default: { color: "#E8523B" } },
  "vibefield.widgetlab.gold-knot": { default: { metal: "gold" } },
  "vibefield.widgetlab.shapes": { default: { accentIdx: 0 } },
  "vibefield.widgetlab.orbit-cube": { default: { hue: 200 } },
};
