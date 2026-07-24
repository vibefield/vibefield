import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import {
  AuditRecordV1 as AuditRecordSchemaV1,
  type AuditRecordV1,
} from "@vibefield/contracts/diagnostics";
import { type AuditRecordBase, auditChainHash, MAX_AUDIT_RECORD_BYTES } from "./model";

export interface AuditIntegrityResult {
  valid: boolean;
  checkpointed: boolean;
  records: AuditRecordV1[];
  bytes: number;
  firstHash: string | null;
  lastHash: string | null;
  reason?:
    | "unsafe-file"
    | "scan-cap"
    | "oversized-line"
    | "partial-line"
    | "invalid-record"
    | "broken-chain"
    | "invalid-checkpoint"
    | "checkpoint-mismatch";
}

type SmallJsonResult =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "value"; value: unknown };

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 64);
  }
  return error instanceof Error && error.name !== "" ? error.name.slice(0, 64) : "UNKNOWN";
}

async function readSmallJson(path: string, maxBytes: number): Promise<SmallJsonResult> {
  let handle: FileHandle | null = null;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return { state: "invalid" };
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.byteLength) {
      const read = await handle.read(data, offset, data.byteLength - offset, offset);
      if (read.bytesRead <= 0) return { state: "invalid" };
      offset += read.bytesRead;
    }
    return { state: "value", value: JSON.parse(data.toString("utf8")) };
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { state: "absent" } : { state: "invalid" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Bounded reader used by corruption tests and explicit support export. A
 * valid chain is called tamper-evident only: the optional close checkpoint has
 * no trust anchor outside the same user boundary. */
export async function verifyAuditSegment(
  path: string,
  maxBytes = 64 * 1024 * 1024,
): Promise<AuditIntegrityResult> {
  const invalid = (reason: AuditIntegrityResult["reason"], bytes = 0): AuditIntegrityResult => ({
    valid: false,
    checkpointed: false,
    records: [],
    bytes,
    firstHash: null,
    lastHash: null,
    ...(reason !== undefined ? { reason } : {}),
  });
  let handle: FileHandle | null = null;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags);
    const info = await handle.stat();
    if (!info.isFile()) return invalid("unsafe-file");
    if (info.size > maxBytes) return invalid("scan-cap", info.size);

    const records: AuditRecordV1[] = [];
    const fileHash = createHash("sha256");
    let pending = Buffer.alloc(0);
    let position = 0;
    let previousHash: string | null = null;
    let firstHash: string | null = null;
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (position < info.size) {
      const length = Math.min(chunk.byteLength, info.size - position);
      const read = await handle.read(chunk, 0, length, position);
      if (read.bytesRead <= 0) return invalid("partial-line", position);
      const received = Buffer.from(chunk.subarray(0, read.bytesRead));
      fileHash.update(received);
      position += read.bytesRead;
      let combined =
        pending.byteLength === 0
          ? received
          : Buffer.concat([pending, received], pending.byteLength + received.byteLength);
      let newline = combined.indexOf(0x0a);
      while (newline >= 0) {
        if (newline > MAX_AUDIT_RECORD_BYTES) return invalid("oversized-line", position);
        const raw = combined.subarray(0, newline).toString("utf8");
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          return invalid("invalid-record", position);
        }
        const parsed = AuditRecordSchemaV1.safeParse(parsedJson);
        if (!parsed.success) return invalid("invalid-record", position);
        const record = parsed.data;
        const integrity = record.integrity;
        if (integrity === undefined) return invalid("invalid-record", position);
        const { integrity: _integrity, ...base } = record;
        const expected = auditChainHash(base as AuditRecordBase, previousHash);
        if (integrity.previousHash !== previousHash || integrity.recordHash !== expected) {
          return invalid("broken-chain", position);
        }
        firstHash ??= integrity.recordHash;
        previousHash = integrity.recordHash;
        records.push(record);
        combined = combined.subarray(newline + 1);
        newline = combined.indexOf(0x0a);
      }
      if (combined.byteLength > MAX_AUDIT_RECORD_BYTES) {
        return invalid("oversized-line", position);
      }
      pending = Buffer.from(combined);
    }
    if (pending.byteLength > 0) return invalid("partial-line", info.size);

    const checkpoint = await readSmallJson(`${path}.integrity.json`, 8 * 1024);
    if (checkpoint.state === "invalid") return invalid("invalid-checkpoint", info.size);
    let checkpointed = false;
    if (checkpoint.state === "value") {
      if (checkpoint.value === null || typeof checkpoint.value !== "object") {
        return invalid("invalid-checkpoint", info.size);
      }
      const value = checkpoint.value as Record<string, unknown>;
      const validShape =
        value["v"] === 1 &&
        value["algorithm"] === "sha256-chain-v1" &&
        value["records"] === records.length &&
        value["bytes"] === info.size &&
        value["firstHash"] === firstHash &&
        value["lastHash"] === previousHash &&
        value["fileSha256"] === fileHash.digest("hex");
      if (!validShape) return invalid("checkpoint-mismatch", info.size);
      checkpointed = true;
    }
    return {
      valid: true,
      checkpointed,
      records,
      bytes: info.size,
      firstHash,
      lastHash: previousHash,
    };
  } catch {
    return invalid("unsafe-file");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
