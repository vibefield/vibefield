const STUDIO_PATH = "/studio.html";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Fail-closed URL derivation for the development-only Studio renderer. */
export function studioRendererUrl(baseUrl: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("the Studio renderer base must be a valid URL");
  }
  if (
    base.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(base.hostname) ||
    base.username !== "" ||
    base.password !== ""
  ) {
    throw new Error("the Studio renderer base must use a credential-free loopback HTTP origin");
  }
  return new URL(STUDIO_PATH, base).href;
}
