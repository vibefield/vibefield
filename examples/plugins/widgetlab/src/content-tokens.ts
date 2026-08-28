/**
 * Committed content surfaces (DESIGN.md §2.2): a card's own color is content,
 * not theme, and its stable identity is shared — the widget body, the folder
 * preview minis, and the design catalog all read ONE constant. This module is
 * a leaf on purpose: the `/design-system` door re-exports it without pulling
 * the plugin's renderer graph.
 */
export const WEATHER_GRADIENT = "linear-gradient(135deg, #3A86FF 0%, #1D4ED8 55%, #0B2AB5 100%)";
