import FieldProduct

/// F1b (FW-D5, the kit's half) — the phone's approval for a link to one desktop, asked of its HOME.
///
/// The desktops made `freeway.approve` routable through the home (M63 `599998fdd`;
/// `packages/contracts/src/freeway.ts`, `FreewayApproveParams`): `{}` asks the home for a link to
/// itself, and `{device}` asks the home to forward the ask whole to that desktop. That desktop mints
/// under its OWN floor's key for the phone its own roster knows, named by
/// `onBehalfOf.clientDeviceId`, which the home fills from its roster's correlation of this phone's
/// node and never from anything the phone says. So the phone holds one door, its home's (FW-R6),
/// and probes no other desktop (FW-R3).
///
/// Only the approval moves here. A terminal ticket, its renewal and Resume still ask the desktop
/// that owns the session over its own door (DS-8): routing those asks through the home is each its
/// own desktop slice first (SP-7).
public enum FreewayApproval {
  public static let method = "freeway.approve"

  /// The kit's own refusal when there is no home door to ask through: `UNAVAILABLE {service:
  /// "freeway", state: "no_door"}`, retryable — the phone re-homes, and the next ask goes there.
  public static let noHome = FieldProductError(
    kind: "UNAVAILABLE", message: "no connection to the home desktop", retryable: true,
    details: .object([
      "service": .string(FreewayContract.Approval.service), "state": .string(noDoor),
    ]))

  /// The kit's own state word for "no door to ask", as the terminal's and Files' refusals say it.
  static let noDoor = "no_door"

  /// The ask's params: nothing for the home itself, the other desktop's roster id otherwise.
  public static func params(for deviceId: String, home: String) -> JSONValue {
    deviceId == home ? .object([:]) : .object(["device": .string(deviceId)])
  }

  /// A refusal of the ask, said in the phone's words — the desktop by name, the way the attach
  /// card names it ("couldn't reach studio's terminal") — with its kind, retryability and details
  /// kept, so whoever retries still reads the door's own taxonomy. A refusal the phone has no words
  /// for keeps the door's own.
  public static func said(_ error: FieldProductError, desktop: String) -> FieldProductError {
    guard let words = words(error, desktop: desktop) else { return error }
    return FieldProductError(
      kind: error.kind, message: words, retryable: error.retryable, details: error.details,
      code: error.code)
  }

  /// The sentence for each refusal the desktops send (`freeway-forwarded-approval.e2e.test.ts`
  /// proves their shapes), in the order the owner checks them.
  static func words(_ error: FieldProductError, desktop: String) -> String? {
    // The owner refuses a forward with no phone behind it, or one naming a desktop: asking again
    // changes nothing (not retryable), so the words do not promise it will.
    if error.kind == "FORBIDDEN_SCOPE" {
      return "\(desktop) won't approve a connection from this phone"
    }
    guard let unavailable = error.unavailable else { return nil }
    switch (unavailable.service, unavailable.state) {
    case (FreewayContract.Approval.service, FreewayContract.Approval.stateUncorrelated):
      // Its roster has not matched this phone's node to a device yet; retryable.
      return "\(desktop) doesn't know this phone yet"
    case (FreewayContract.Approval.service, FreewayContract.Approval.stateUnread):
      // Its floor's state is not read yet (or the floor predates the freeway); retryable.
      return "\(desktop) isn't ready for this phone's connection yet"
    case (FreewayContract.Approval.service, FreewayContract.Approval.stateDown):
      // Its freeway host is not running: not declared yet, between generations, or parked.
      return "\(desktop) isn't taking connections from phones right now"
    case (FreewayContract.Approval.service, noDoor):
      return "this phone isn't connected to its home desktop"
    case ("peer-link", _):
      // The home's own link to the owner, never a guess about the owner (DS-D13).
      return "your home desktop can't reach \(desktop) right now"
    default:
      return nil
    }
  }
}
