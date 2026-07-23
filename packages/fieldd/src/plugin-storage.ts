import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PLUGIN_LIMITS } from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// Plugin KV storage (spec §16.3, P5): small JSON control data, self-scoped,
// quota-bounded, persisted at <dataDir>/plugins/<id>/data/kv.json (atomic
// tmp+rename). KEYS ARE OPAQUE — they index a JSON map and never touch the
// filesystem, so "../.." is data, not a path (the traversal tests pin it).
// File STREAMS (§16.3 files) are deliberately absent this slice: bodies ride
// a ticketed lane (EL2), and that lane is its own slice.
//
// Quota errors are typed with current/limit bytes and the §22.5 discriminator
// (pluginKind: PLUGIN_QUOTA_EXCEEDED).

interface KvFile {
  version: 1;
  entries: Record<string, unknown>;
}

export class PluginKvStore {
  private readonly cache = new Map<string, KvFile>();

  constructor(private readonly dataDir: string) {}

  private path(pluginId: string): string {
    return join(this.dataDir, "plugins", pluginId, "data", "kv.json");
  }

  private async load(pluginId: string): Promise<KvFile> {
    const cached = this.cache.get(pluginId);
    if (cached !== undefined) return cached;
    try {
      const parsed = JSON.parse(await readFile(this.path(pluginId), "utf8")) as KvFile;
      if (parsed !== null && typeof parsed === "object" && parsed.version === 1) {
        const file: KvFile = { version: 1, entries: { ...parsed.entries } };
        this.cache.set(pluginId, file);
        return file;
      }
    } catch {
      // first use
    }
    const file: KvFile = { version: 1, entries: {} };
    this.cache.set(pluginId, file);
    return file;
  }

  private async save(pluginId: string, file: KvFile): Promise<void> {
    this.cache.set(pluginId, file);
    const path = this.path(pluginId);
    await mkdir(join(this.dataDir, "plugins", pluginId, "data"), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file)}\n`, "utf8");
    await rename(tmp, path);
  }

  async get(pluginId: string, key: string): Promise<unknown> {
    const file = await this.load(pluginId);
    return key in file.entries ? file.entries[key] : null;
  }

  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new RpcCallError("PRECONDITION_FAILED", "kv values must be JSON-serializable", false);
    }
    if (serialized === undefined)
      throw new RpcCallError("PRECONDITION_FAILED", "kv values must be JSON-serializable", false);
    const valueBytes = Buffer.byteLength(serialized, "utf8");
    if (valueBytes > PLUGIN_LIMITS.KV_VALUE_MAX_BYTES)
      throw new RpcCallError("PRECONDITION_FAILED", `kv value exceeds the per-value cap`, false, {
        pluginKind: "PLUGIN_QUOTA_EXCEEDED",
        currentBytes: valueBytes,
        limitBytes: PLUGIN_LIMITS.KV_VALUE_MAX_BYTES,
      });
    const file = await this.load(pluginId);
    const next: KvFile = {
      version: 1,
      entries: { ...file.entries, [key]: JSON.parse(serialized) as unknown },
    };
    const totalBytes = Buffer.byteLength(JSON.stringify(next), "utf8");
    if (totalBytes > PLUGIN_LIMITS.KV_TOTAL_MAX_BYTES)
      throw new RpcCallError("PRECONDITION_FAILED", `kv store exceeds its total quota`, false, {
        pluginKind: "PLUGIN_QUOTA_EXCEEDED",
        currentBytes: totalBytes,
        limitBytes: PLUGIN_LIMITS.KV_TOTAL_MAX_BYTES,
      });
    await this.save(pluginId, next);
  }

  async delete(pluginId: string, key: string): Promise<void> {
    const file = await this.load(pluginId);
    if (!(key in file.entries)) return;
    const entries = { ...file.entries };
    delete entries[key];
    await this.save(pluginId, { version: 1, entries });
  }

  async list(pluginId: string, prefix?: string): Promise<string[]> {
    const file = await this.load(pluginId);
    const keys = Object.keys(file.entries).sort();
    return prefix === undefined ? keys : keys.filter((k) => k.startsWith(prefix));
  }
}
