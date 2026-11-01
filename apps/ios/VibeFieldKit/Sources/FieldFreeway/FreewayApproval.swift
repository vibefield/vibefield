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
public enum FreewayApproval {
  public static let method = "freeway.approve"

  /// No home door to ask through (stub).
  public static let noHome = FieldProductError(kind: "INTERNAL", message: "stub")

  /// The ask's params: nothing for the home itself, the other desktop's roster id otherwise.
  public static func params(for deviceId: String, home: String) -> JSONValue {
    .object([:])
  }

  /// A refusal of the ask, said in the phone's words with its kind, retryability and details kept,
  /// so whoever retries still reads the door's own taxonomy.
  public static func said(_ error: FieldProductError, desktop: String) -> FieldProductError {
    error
  }
}
