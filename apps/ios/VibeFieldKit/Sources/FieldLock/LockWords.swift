/// WI-3 — every word the lock says, held to DESIGN.md §9 "The lock". Every word names the method the phone has:
/// Face ID, Touch ID, or the passcode where neither is set up.
public struct LockWords: Equatable, Sendable {
  public let method: LockMethod

  public init(_ method: LockMethod) {
    self.method = method
  }

  // MARK: The way in's last step (WI-D3 A)

  /// The steps capsule's third name.
  public var step: String { "" }
  public var offerTitle: String { "" }
  public var offerLine: String { "" }
  public var lockWith: String { "" }
  public static let notNow = ""
  public static let offerNote = ""

  // MARK: The curtain (WI-D5 A)

  public static let lockedTitle = ""
  public var unlockWith: String { "" }
  /// Said under Unlock only where the passcode is the fallback, not the method.
  public var passcodeToo: String? { nil }
  /// What iOS shows with the ask where Face ID's own reason (the app's Info.plist) does not stand.
  public var reason: String { "" }

  // MARK: Settings › This phone › Lock

  public static let row = ""
  public static func rowValue(isOn: Bool) -> String { "" }
  public static let toggle = ""
  public var toggleLine: String { "" }
  public var requireHead: String { "" }
  public static func delay(_ delay: LockDelay) -> String { "" }
  public var requireFoot: String { "" }
  public var offFoot: String { "" }
  public static let noPasscodeFoot = ""
}
