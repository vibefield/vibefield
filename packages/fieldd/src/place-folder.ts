import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { PlaceRef } from "@vibefield/contracts";
import { RpcCallError } from "./native-link";
import type { OwnPlace } from "./projects/project-groups";

/** PJ-7 (Q1 (a)) — how a caller's place ref is read: this desktop's own facts (`ProjectGroups.ownPlace`). */
export type PlaceResolver = (ref: PlaceRef) => OwnPlace;

/** Whether `path` is a folder now; a path that cannot be read is not. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * PJ-7 (Q1 (a)) — the folder a birth by place runs in: the place's own path, from this desktop's own facts, and only
 * while it is a folder here now (the facts are sticky: a deleted place keeps its last ones, so the disk is asked too).
 * Refused in fieldd's words, the ref in the details and never the path (the caller sent none):
 * - another desktop's place is `not-here` (a desktop starts only in its own places; PJ-8 carries acts across desktops);
 * - an id with no facts here is `unknown-place`;
 * - a folder gone or unmounted is `missing-cwd`.
 *
 * Item 587 (2026-11-19): lifted out of the agent runtime so `agent.spawn` and `terminal.create` read a place by ONE
 * rule and cannot drift. `details` leads each refusal's details: agent.spawn's carry its `provider`, terminal.create's
 * carry nothing more. No resolver refuses every place `unknown-place`.
 */
export function placeFolderOf(
  resolve: PlaceResolver | undefined,
  ref: PlaceRef,
  details: Readonly<Record<string, unknown>> = {},
): { path: string; placeId: string } {
  const found = resolve?.(ref) ?? { state: "unknown" as const };
  const place = { device: ref.device, placeId: ref.placeId };
  if (found.state === "not-here") {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "that place is on another desktop; a desktop starts agents only in its own places",
      false,
      { ...details, reason: "not-here", place },
    );
  }
  if (found.state === "unknown") {
    throw new RpcCallError("NOT_FOUND", "this desktop knows no place by that id", false, {
      ...details,
      reason: "unknown-place",
      place,
    });
  }
  const { facts } = found;
  if (!facts.exists || !facts.mounted || !isAbsolute(facts.path) || !isDirectory(facts.path)) {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      facts.mounted
        ? "the place's folder is gone from this device"
        : "the place's folder is on a volume that is not mounted",
      false,
      { ...details, reason: "missing-cwd", place },
    );
  }
  return { path: facts.path, placeId: facts.placeId };
}
