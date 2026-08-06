const UI_BENCH_PATH = "/design-system.html";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The bench is a development-only local renderer. Keeping URL validation in
 * a pure module makes the Electron entry fail closed without making tests load
 * Electron itself. */
export function parseUiBenchUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error("VIBEFIELD_UI_BENCH_URL is required");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("VIBEFIELD_UI_BENCH_URL must be a valid URL");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== UI_BENCH_PATH
  ) {
    throw new Error(`VIBEFIELD_UI_BENCH_URL must target loopback${UI_BENCH_PATH}`);
  }
  return url.href;
}
