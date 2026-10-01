import Foundation

/// SP-2 (g) — the phone's connection budget: `PHONE_BUDGET` in
/// `packages/contracts/src/registries.ts`, mirrored as literals because this
/// kit is outside `pnpm verify` and has no generator pointed at it.
/// `pnpm check:ios-fixtures` pins each literal to the registry VERBATIM, so a
/// number that moves on one side only is a red there, never a quiet
/// disagreement about how many sockets this phone may hold.
///
/// These are the AS-BUILT numbers (2026-10-01). SP-D12 is OPEN — its lean is
/// one door to the HOME desktop, two attached terminals (the open card and one
/// warm), one web view — and when it rules, the registry moves and this file
/// moves with it.
public enum PhoneBudget {
  /// One product-door WebSocket per self desktop. The phone dials every self
  /// desktop its roster lists until DS-8 homes it to one, so the honest number
  /// today is PER DESKTOP: a replacement door waits for its predecessor's
  /// socket to close.
  public static let doorsPerDesktop = 1
  /// One attached terminal: its control leg and its frames leg.
  public static let terminalLegs = 2
  /// One web view. Nothing on the phone opens one yet (SP-4).
  public static let webViews = 1
}
