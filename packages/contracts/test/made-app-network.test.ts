import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MadeAppReach } from "../src/artifacts";
import {
  MADE_APP_VIEW_TAIL,
  MadeAppNetworkHost,
  MadeAppNetworkHosts,
  MadeAppNetworkPolicy,
  type MadeAppViewTheme,
  madeAppPolicyFromManifest,
  madeAppReachOf,
  madeAppServeHeaders,
  madeAppViewHead,
  readMadeAppEnvironment,
  readVibefieldAppManifest,
  ServeHeaderName,
  ServeHeaders,
  ServeHeaderValue,
  VIBEFIELD_APP_MANIFEST_FILE,
  VibefieldAppManifest,
} from "../src/made-app-network";
import {
  MADE_APP_LIMITS,
  MADE_APP_SERVE_POLICY,
  MADE_APP_VIEW,
  SERVE_HEADER_FORBIDDEN,
  SERVE_HEADER_LIMITS,
} from "../src/registries";

// DR-1a (`draft/thinking-drive.md` v0.2, RULED 2026-11-06: DR-D2 (a), DR-D3 (a), DR-D11 (a);
// DR-D13 (a) at its lean) — a made app's network policy, its serve's headers, its view and a
// captured page's environment, held to four vectors and a wire fixture. The hosts and the theme
// are INPUTS throughout: nothing here is a platform's.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const vector = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;

interface PolicyRow {
  case: string;
  policy?: unknown;
  manifest?: unknown;
  csp?: string;
  cspBytes?: number;
  cspSha256?: string;
  listBytes?: number;
  reach?: string[];
  refused?: string;
}

interface HeaderEntry {
  name: string;
  value?: string;
  fill?: string;
  bytes?: number;
}

interface HeaderList {
  case: string;
  headers?: HeaderEntry[];
  count?: number;
}

interface HeadersVector {
  directives: string[];
  neverDirectives: string[];
  fixedHeaders: { name: string; value: string }[];
  policies: PolicyRow[];
  headers: {
    acceptedNames: string[];
    forbiddenNames: string[];
    refusedNames: string[];
    acceptedValues: string[];
    refusedValues: string[];
    acceptedLists: HeaderList[];
    refusedLists: HeaderList[];
  };
}

interface ViewVector {
  tail: string;
  views: { case: string; theme: MadeAppViewTheme; head: string }[];
  embed: { theme: MadeAppViewTheme; page: string; view: string };
  refusedVariables: { case: string; variable: unknown }[];
  refusedThemes: { case: string; theme: unknown }[];
}

interface ManifestRow {
  case: string;
  manifest: Record<string, unknown>;
  repeat?: { host: string; count: number };
  network: string[] | null;
  stripped?: unknown[];
}

interface EnvironmentRow {
  case: string;
  environment: unknown;
  policy: MadeAppNetworkPolicy;
  csp?: string;
  reach: string[];
  variables: [string, string][];
  stripped: unknown[];
}

const HEADERS = vector<HeadersVector>("made-app-headers.vector");
const VIEWS = vector<ViewVector>("made-app-view.vector");
const MANIFESTS = vector<{ rows: ManifestRow[] }>("vibefield-app-manifest-hostile.vector");
const ENVIRONMENTS = vector<{ rows: EnvironmentRow[] }>("made-app-environment.vector");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const pad = (i: number) => String(i).padStart(2, "0");

/** A row's policy: its own, or the one its manifest reads as. */
function policyOf(row: PolicyRow): MadeAppNetworkPolicy {
  if (row.manifest === undefined) return row.policy as MadeAppNetworkPolicy;
  return madeAppPolicyFromManifest(VibefieldAppManifest.parse(row.manifest));
}

/** The directive names of a CSP, in order. */
function directivesOf(csp: string): string[] {
  return csp.split("; ").map((directive) => directive.split(" ")[0] ?? "");
}

function listBytes(headers: readonly { name: string; value: string }[]): number {
  const bytes = (h: { name: string; value: string }) => Buffer.byteLength(h.name + h.value);
  return headers.reduce((sum, h) => sum + bytes(h), 0);
}

function headerValueOf(entry: HeaderEntry): string {
  return entry.value ?? (entry.fill ?? "").repeat(entry.bytes ?? 0);
}

/** A vector's header list: its entries, or `count` headers `X-H00`… with value `1`. */
function listOf(row: HeaderList): { name: string; value: string }[] {
  if (row.count !== undefined) {
    return Array.from({ length: row.count }, (_, i) => ({ name: `X-H${pad(i)}`, value: "1" }));
  }
  return (row.headers ?? []).map((entry) => ({ name: entry.name, value: headerValueOf(entry) }));
}

/** A host of exactly `bytes` bytes: `h` and two digits, `x`s, then `.example.com`. */
function host(i: number, bytes: number): string {
  return `h${pad(i)}${"x".repeat(bytes - 15)}.example.com`;
}

/** A manifest row's `stripped`, or, for a `repeat` row with none of its own, every entry after
 * the first as a repeat. */
function strippedOf(row: ManifestRow): unknown[] {
  if (row.stripped !== undefined) return row.stripped;
  const { host: entry, count } = row.repeat ?? { host: "", count: 1 };
  const repeat = { field: "network", entry, why: "repeat" };
  return Array.from({ length: count - 1 }, () => repeat);
}

type Source = MadeAppNetworkPolicy["source"];

/** One list in all six directives. */
function everywhere(list: string[], source: Source = "captured"): MadeAppNetworkPolicy {
  const hosts = { script: list, style: list, img: list, font: list, media: list, connect: list };
  return { source, hosts };
}

describe("the serve's headers: the policy's hosts as INPUT, VibeField's policy as data", () => {
  const accepted = HEADERS.policies.filter((row) => row.refused === undefined);
  const refused = HEADERS.policies.filter((row) => row.refused !== undefined);

  for (const row of accepted) {
    it(`composes: ${row.case}`, () => {
      const policy = policyOf(row);
      if (row.manifest !== undefined && row.policy !== undefined) {
        expect(policy).toEqual(row.policy);
      }
      expect(MadeAppNetworkPolicy.safeParse(policy).success).toBe(true);
      const answer = madeAppServeHeaders(policy);
      if (!answer.ok) throw new Error(`refused ${answer.refused}`);
      const [csp, ...rest] = answer.headers;
      expect(csp?.name).toBe(MADE_APP_SERVE_POLICY.CSP_HEADER);
      expect(rest).toEqual(HEADERS.fixedHeaders);
      const value = csp?.value ?? "";
      if (row.csp !== undefined) expect(value).toBe(row.csp);
      if (row.cspBytes !== undefined) expect(Buffer.byteLength(value)).toBe(row.cspBytes);
      if (row.cspSha256 !== undefined) expect(sha256(value)).toBe(row.cspSha256);
      if (row.listBytes !== undefined) expect(listBytes(answer.headers)).toBe(row.listBytes);
      expect(directivesOf(value)).toEqual(HEADERS.directives);
      expect(ServeHeaders.safeParse(answer.headers).success).toBe(true);
      const reach = madeAppReachOf(policy);
      if (row.reach !== undefined) expect(reach).toEqual(row.reach);
      expect(MadeAppReach.safeParse(reach).success).toBe(true);
    });
  }

  for (const row of refused) {
    it(`refuses: ${row.case}`, () => {
      const policy = policyOf(row);
      expect(madeAppServeHeaders(policy)).toEqual({ ok: false, refused: row.refused });
      expect(MadeAppNetworkPolicy.safeParse(policy).success).toBe(false);
    });
  }

  it("never names a sandbox: no accepted row's CSP, and nowhere in the policy's data", () => {
    expect(HEADERS.neverDirectives).toEqual(["sandbox"]);
    for (const row of accepted) {
      const answer = madeAppServeHeaders(policyOf(row));
      const csp = answer.ok ? (answer.headers[0]?.value ?? "") : "";
      for (const never of HEADERS.neverDirectives) expect(directivesOf(csp)).not.toContain(never);
    }
    expect(JSON.stringify(MADE_APP_SERVE_POLICY)).not.toMatch(/sandbox/i);
  });

  it("fits the worst policy at the cap in one header value, and refuses one host more", () => {
    const { UNION_HOSTS, HOST_BYTES, REFUSED_HOSTS_OVER_CAP } = MADE_APP_SERVE_POLICY;
    expect(UNION_HOSTS).toBe(MADE_APP_LIMITS.REACH_HOSTS);
    const worst = Array.from({ length: UNION_HOSTS }, (_, i) => host(i, HOST_BYTES));
    expect(worst.every((name) => MadeAppNetworkHost.safeParse(name).success)).toBe(true);
    const answer = madeAppServeHeaders(everywhere(worst));
    if (!answer.ok) throw new Error(`refused ${answer.refused}`);
    const csp = answer.headers[0]?.value ?? "";
    expect(Buffer.byteLength(csp)).toBeLessThanOrEqual(SERVE_HEADER_LIMITS.VALUE_BYTES);
    expect(listBytes(answer.headers)).toBeLessThanOrEqual(SERVE_HEADER_LIMITS.LIST_BYTES);
    expect(answer.headers.length).toBeLessThanOrEqual(SERVE_HEADER_LIMITS.COUNT);
    const more = Array.from({ length: UNION_HOSTS + 1 }, (_, i) => host(i, 20));
    expect(madeAppServeHeaders(everywhere(more))).toEqual({
      ok: false,
      refused: REFUSED_HOSTS_OVER_CAP,
    });
    expect(MadeAppNetworkHost.safeParse(host(0, HOST_BYTES + 1)).success).toBe(false);
  });

  it("names a host list for every fetch directive the header composes, in its order", () => {
    const keys = MADE_APP_SERVE_POLICY.FETCH.map(({ key }) => key);
    expect(Object.keys(MadeAppNetworkHosts.shape)).toEqual(keys);
  });
});

describe("a serve's header list: truffle T-1's rules as a belt, and a superset of them", () => {
  const rules = HEADERS.headers;

  it("admits a name of letters, digits and dashes up to NAME_BYTES, lookalikes included", () => {
    for (const name of rules.acceptedNames) {
      expect(ServeHeaderName.safeParse(name).success, name).toBe(true);
    }
    const longest = Math.max(...rules.acceptedNames.map((name) => name.length));
    expect(longest).toBe(SERVE_HEADER_LIMITS.NAME_BYTES);
  });

  it("refuses every forbidden name in any case, and every Proxy-* name", () => {
    for (const name of rules.forbiddenNames) {
      expect(ServeHeaderName.safeParse(name).success, name).toBe(false);
    }
    const lower = rules.forbiddenNames.map((name) => name.toLowerCase());
    for (const name of SERVE_HEADER_FORBIDDEN.NAMES) expect(lower).toContain(name);
    for (const prefix of SERVE_HEADER_FORBIDDEN.PREFIXES) {
      expect(lower.some((name) => name.startsWith(prefix))).toBe(true);
    }
  });

  it("holds every name T-1's table refuses (a looser contract fails at the serve's add)", () => {
    const t1 = [
      "connection",
      "keep-alive",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "set-cookie",
      "content-length",
      "host",
    ];
    for (const name of t1) expect(SERVE_HEADER_FORBIDDEN.NAMES).toContain(name);
    expect(SERVE_HEADER_FORBIDDEN.PREFIXES).toContain("proxy-");
  });

  it("refuses a name outside its grammar or one byte past NAME_BYTES", () => {
    for (const name of rules.refusedNames) {
      expect(ServeHeaderName.safeParse(name).success, JSON.stringify(name)).toBe(false);
    }
    const longest = Math.max(...rules.refusedNames.map((name) => name.length));
    expect(longest).toBe(SERVE_HEADER_LIMITS.NAME_BYTES + 1);
  });

  it("admits VCHAR, SP and HTAB inside a value", () => {
    for (const value of rules.acceptedValues) {
      expect(ServeHeaderValue.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }
  });

  it("refuses empty, edge whitespace, line breaks, controls, DEL and non-ASCII", () => {
    for (const value of rules.refusedValues) {
      expect(ServeHeaderValue.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  for (const row of rules.acceptedLists) {
    it(`admits a list: ${row.case}`, () => {
      expect(ServeHeaders.safeParse(listOf(row)).success).toBe(true);
    });
  }

  for (const row of rules.refusedLists) {
    it(`refuses a list: ${row.case}`, () => {
      expect(ServeHeaders.safeParse(listOf(row)).success).toBe(false);
    });
  }
});

describe("vibefield.app.json: a reader strips what it cannot read, never the manifest", () => {
  it("is the file a built app declares itself in", () => {
    expect(VIBEFIELD_APP_MANIFEST_FILE).toBe("vibefield.app.json");
  });

  for (const row of MANIFESTS.rows) {
    it(row.case, () => {
      const input = { ...row.manifest };
      if (row.repeat !== undefined) input.network = Array(row.repeat.count).fill(row.repeat.host);
      const read = VibefieldAppManifest.parse(input);
      expect(read.network ?? null).toEqual(row.network);
      for (const [key, value] of Object.entries(row.manifest)) {
        if (key !== "network") expect(read[key], key).toEqual(value);
      }
      const policy = madeAppPolicyFromManifest(read);
      expect(policy.source).toBe("manifest");
      for (const { key } of MADE_APP_SERVE_POLICY.FETCH) {
        expect(policy.hosts[key] ?? [], key).toEqual(row.network ?? []);
      }
      const { manifest, stripped } = readVibefieldAppManifest(input);
      expect(manifest).toEqual(read);
      expect(stripped).toEqual(strippedOf(row));
    });
  }

  it("reads the valid fixture's hosts into every fetch directive, in its order", () => {
    const raw = vector("vibefield-app-manifest.valid");
    const manifest = VibefieldAppManifest.parse(raw);
    expect(manifest.name).toBe("Ledger");
    const network = ["cdn.example.com", "api.example.com", "fonts.example.org"];
    expect(manifest.network).toEqual(network);
    expect(madeAppPolicyFromManifest(manifest)).toEqual(everywhere(network, "manifest"));
    expect(readVibefieldAppManifest(raw)).toEqual({ manifest, stripped: [] });
  });

  it("reads a value that is not a JSON object as an empty manifest, and says so", () => {
    const whole = [{ field: "manifest", entry: null, why: "unreadable" }];
    for (const raw of [null, "Ledger", 7, ["cdn.example.com"]]) {
      const read = readVibefieldAppManifest(raw);
      expect(read, JSON.stringify(raw)).toEqual({ manifest: {}, stripped: whole });
    }
  });
});

describe("a captured page's environment: read into a policy and a view's variables", () => {
  for (const row of ENVIRONMENTS.rows) {
    it(row.case, () => {
      const read = readMadeAppEnvironment(row.environment);
      expect(read.policy).toEqual(row.policy);
      expect(read.variables).toEqual(row.variables);
      expect(read.stripped).toEqual(row.stripped);
      expect(MadeAppNetworkPolicy.safeParse(read.policy).success).toBe(true);
      expect(madeAppReachOf(read.policy)).toEqual(row.reach);
      const answer = madeAppServeHeaders(read.policy);
      if (!answer.ok) throw new Error(`refused ${answer.refused}`);
      if (row.csp !== undefined) expect(answer.headers[0]?.value).toBe(row.csp);
      expect(madeAppViewHead({ colorScheme: "light", variables: read.variables }).ok).toBe(true);
    });
  }

  it("is its hosts' one door: R-1's map handed to a policy as it is refuses the policy", () => {
    const golden = ENVIRONMENTS.rows[0]?.environment as { hosts: unknown };
    const policy = { source: "captured", hosts: golden.hosts } as MadeAppNetworkPolicy;
    expect(MadeAppNetworkPolicy.safeParse(policy).success).toBe(false);
    expect(madeAppServeHeaders(policy)).toEqual({
      ok: false,
      refused: MADE_APP_SERVE_POLICY.REFUSED_POLICY,
    });
  });

  it("keeps the first VARIABLES readable variables by name, and strips the rest", () => {
    const { VARIABLES } = MADE_APP_VIEW;
    const names = Array.from({ length: VARIABLES + 1 }, (_, i) => `--v${pad(i)}`);
    const variables = Object.fromEntries(names.map((name) => [name, "#fff"]));
    const read = readMadeAppEnvironment({ variables });
    expect(read.variables.map(([name]) => name)).toEqual(names.slice(0, VARIABLES));
    expect(read.stripped).toEqual([
      { field: "variables", entry: names[VARIABLES], why: "over-cap" },
    ]);
  });
});

describe("the view: the theme as INPUT, in a grammar that cannot leave its declaration", () => {
  const refusal = { ok: false, refused: MADE_APP_VIEW.REFUSED_THEME };

  for (const row of VIEWS.views) {
    it(`composes the head: ${row.case}`, () => {
      expect(madeAppViewHead(row.theme)).toEqual({ ok: true, head: row.head });
    });
  }

  it("closes with its tail, and embeds the page whole inside <body>, its own CSP meta too", () => {
    expect(MADE_APP_VIEW_TAIL).toBe(VIEWS.tail);
    const answer = madeAppViewHead(VIEWS.embed.theme);
    if (!answer.ok) throw new Error(`refused ${answer.refused}`);
    const view = `${answer.head}${VIEWS.embed.page}${MADE_APP_VIEW_TAIL}`;
    expect(view).toBe(VIEWS.embed.view);
    const meta = view.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(view.indexOf("<body>"));
  });

  for (const row of VIEWS.refusedVariables) {
    it(`refuses a variable: ${row.case}`, () => {
      const theme = { colorScheme: "light", variables: [row.variable] } as MadeAppViewTheme;
      expect(madeAppViewHead(theme)).toEqual(refusal);
    });
  }

  for (const row of VIEWS.refusedThemes) {
    it(`refuses a theme: ${row.case}`, () => {
      expect(madeAppViewHead(row.theme as MadeAppViewTheme)).toEqual(refusal);
    });
  }

  it("bounds the variables, a name and a value at MADE_APP_VIEW's numbers", () => {
    const { VARIABLES, VARIABLE_NAME_BYTES, VALUE_BYTES } = MADE_APP_VIEW;
    const reads = (variables: [string, string][]) =>
      madeAppViewHead({ colorScheme: "light", variables }).ok;
    const many = (n: number) =>
      Array.from({ length: n }, (_, i): [string, string] => [`--v${i}`, "#fff"]);
    expect(reads(many(VARIABLES))).toBe(true);
    expect(reads(many(VARIABLES + 1))).toBe(false);
    const name = (bytes: number) => `--${"a".repeat(bytes - 2)}`;
    expect(reads([[name(VARIABLE_NAME_BYTES), "#fff"]])).toBe(true);
    expect(reads([[name(VARIABLE_NAME_BYTES + 1), "#fff"]])).toBe(false);
    expect(reads([["--x", "a".repeat(VALUE_BYTES)]])).toBe(true);
    expect(reads([["--x", "a".repeat(VALUE_BYTES + 1)]])).toBe(false);
  });
});

describe("the DR-1a rows are pinned (a move is a deliberate edit)", () => {
  it("pins the serve policy's bounds and refusal words", () => {
    const p = MADE_APP_SERVE_POLICY;
    expect([p.UNION_HOSTS, p.HOST_BYTES, p.MANIFEST_ENTRIES]).toEqual([16, 60, 256]);
    expect(p.HOST_PRIVATE_SUFFIXES).toEqual(["localhost", "local", "internal", "home.arpa"]);
    const words = [p.REFUSED_POLICY, p.REFUSED_HOSTS_OVER_CAP, p.REFUSED_HEADERS];
    expect(words).toEqual(["policy-unreadable", "hosts-over-cap", "headers-over-bounds"]);
  });

  it("pins the header limits in bytes", () => {
    expect(SERVE_HEADER_LIMITS).toEqual({
      COUNT: 32,
      NAME_BYTES: 64,
      VALUE_BYTES: 8192,
      LIST_BYTES: 16384,
    });
  });

  it("pins the view's file, version and bounds", () => {
    expect(MADE_APP_VIEW).toEqual({
      FILE: "index.html",
      VERSION: 1,
      PAGE_MAX_BYTES: 16 * 1024 * 1024,
      VARIABLES: 64,
      VARIABLE_NAME_BYTES: 64,
      VALUE_BYTES: 256,
      REFUSED_THEME: "theme-unreadable",
    });
  });
});
