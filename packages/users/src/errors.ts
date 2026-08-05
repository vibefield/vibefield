/** Typed failures of the user directory (spec §3.3). The spec drafted these
 * onto SupervisorErrorKind; they live here instead because the users module is
 * its own package (fieldd's standalone entry needs it too, and a fieldd ⇄
 * supervisor dependency would be circular) — recorded as a UA-1 delta. */
export type UsersErrorKind =
  /** the lock deadline passed with a live incumbent — never broken by force */
  | "users-locked"
  /** the root refuses writes (permissions, read-only volume) */
  | "users-unwritable"
  /** users.json / layout.json present but unreadable or schema-invalid —
   * a typed state, never a silent re-mint over someone's identity */
  | "users-corrupt"
  /** minting was refused by policy (smoke-like mode with an injected root —
   * "don't write someone else's users.json") */
  | "users-mint-refused"
  /** the flat-v1 → users-v2 move could not complete (live pid that would not
   * die; an entry present on both sides) — manual remedy, stated in message */
  | "users-migration-failed";

export class UsersError extends Error {
  constructor(
    readonly kind: UsersErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "UsersError";
  }
}
