const prefix = "Release";
export const meta = { name: `${prefix} check` };
export default { run: true };
export async function pick() {
  return ask("Which one?", ["a", "b", "c", "d", "e"]);
}
