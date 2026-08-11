import type { MonitorParameterGroup } from "../../monitor/parameters";

export interface ListParameters {
  rowHeight: number;
  projectWidth: number;
}

export const DEFAULT_LIST_PARAMETERS: Readonly<ListParameters> = {
  rowHeight: 38,
  projectWidth: 150,
};

export const LIST_PARAMETER_GROUPS: readonly MonitorParameterGroup[] = [
  {
    title: "LIST LAYOUT",
    controls: [
      { key: "rowHeight", label: "Row height", min: 26, max: 72, step: 1, defaultValue: 38 },
      {
        key: "projectWidth",
        label: "Project column",
        min: 90,
        max: 280,
        step: 5,
        defaultValue: 150,
      },
    ],
  },
];

const definitions = LIST_PARAMETER_GROUPS.flatMap((group) => group.controls);

export function normalizeListParameters(value: unknown): ListParameters {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof ListParameters, unknown>>)
      : {};
  const normalized = { ...DEFAULT_LIST_PARAMETERS };
  for (const definition of definitions) {
    const key = definition.key as keyof ListParameters;
    const candidate = source[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    normalized[key] = Math.max(definition.min, Math.min(definition.max, candidate));
  }
  return normalized;
}
