export const NX_CHANGE_MARKER = "@@VIBEFIELD_NX_CHANGE@@";

export function parseNxChangeLine(line) {
  const marker = line.indexOf(NX_CHANGE_MARKER);
  if (marker < 0) return null;
  const encoded = line
    .slice(marker + NX_CHANGE_MARKER.length)
    .trim()
    .split(/\s+/, 1)[0];
  if (!encoded) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      typeof value?.project !== "string" ||
      !Array.isArray(value.files) ||
      !value.files.every((file) => typeof file === "string")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
