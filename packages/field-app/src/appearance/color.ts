export function hexToRgb01(hex: string): [number, number, number] {
  const value = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ];
}
