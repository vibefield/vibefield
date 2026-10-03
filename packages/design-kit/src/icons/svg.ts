import { FIELD_MARKS, type FieldIconName } from "./data";
export type FieldIconFinish = "sticker" | "artwork";
const attributeNames: Record<string, string> = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  fillRule: "fill-rule",
};
function escapeXml(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );
}
/** Export either the cut-out sticker or the original two-ink artwork. */
export function fieldIconSvg(name: FieldIconName, finish: FieldIconFinish = "sticker"): string {
  const mark = FIELD_MARKS[name];
  const shapes = (under = false) =>
    mark.shapes
      .map((shape) => {
        const attrs = under
          ? {
              ...shape.attrs,
              fill: "#fff",
              stroke: "#fff",
              strokeWidth: mark.grid * 0.072,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }
          : shape.attrs;
        return `<${shape.tag} ${Object.entries(attrs)
          .map(
            ([key, value]) =>
              `${attributeNames[key] ?? key}="${escapeXml(typeof value === "string" && value.startsWith("var(--vf-sticker-paper") ? "#fff" : value)}"`,
          )
          .join(" ")}/>`;
      })
      .join("");
  const sticker = finish === "sticker";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.grid} ${mark.grid}" fill="currentColor" stroke="none"><title>${escapeXml(mark.label)}</title>${sticker ? shapes(true) : ""}${shapes()}</svg>`;
}
