/// WI-3 — every word the lock says, held to DESIGN.md §9 "The lock". Every word names the method the phone has:
/// Face ID, Touch ID, or the passcode where neither is set up. Face ID's words are ruled (WI-D3…D7 A); the Touch ID
/// swap, the passcode-only set and the ask's reason are drafts pending James (§9's as-built note).
public struct LockWords: Equatable, Sendable {
  public let method: LockMethod

  public init(_ method: LockMethod) {
    self.method = method
  }

  /// Face ID or Touch ID: a biometric method, with the passcode as iOS's own fallback.
  private var biometric: Bool { method == .faceID || method == .touchID }

  /// The method's name in a sentence ("Face ID", "Touch ID", "your passcode").
  private var name: String {
    switch method {
    case .faceID: "Face ID"
    case .touchID: "Touch ID"
    case .passcode, .none: "your passcode"
    }
  }

  /// The method's name on an act ("Face ID", "Touch ID", "passcode").
  private var act: String { biometric ? name : "passcode" }

  // MARK: The way in's last step (WI-D3 A)

  /// The steps capsule's third name.
  public var step: String { biometric ? name : "Passcode" }
  public var offerTitle: String { "Lock VibeField with \(name)." }
  public var offerLine: String {
    "This phone can type into your agents’ terminals. \(biometric ? name : "Your passcode") keeps that to you."
  }
  public var lockWith: String { "Lock with \(act)" }
  public static let notNow = "Not now"
  public static let offerNote = "You can change this in Settings › Lock."

  // MARK: The curtain (WI-D5 A)

  public static let lockedTitle = "VibeField is locked."
  public var unlockWith: String { "Unlock with \(act)" }
  /// Said under Unlock only where the passcode is the fallback, not the method.
  public var passcodeToo: String? { biometric ? "Your iPhone passcode works too." : nil }
  /// What iOS shows with the ask where Face ID's own reason (the app's Info.plist) does not stand: Touch ID and the
  /// passcode.
  public var reason: String { "Only you can open VibeField on this iPhone." }

  // MARK: Settings › This phone › Lock

  public static let row = "Lock"
  public static func rowValue(isOn: Bool) -> String { isOn ? "On" : "Off" }
  public static let toggle = "Lock VibeField"
  public var toggleLine: String {
    biometric ? "\(name) opens VibeField. When \(name) can’t, your iPhone passcode does." : "Your iPhone passcode opens VibeField."
  }
  public var requireHead: String { "Require \(act)" }
  public static func delay(_ delay: LockDelay) -> String {
    switch delay {
    case .immediately: "Immediately"
    case .oneMinute: "After 1 minute"
    case .fiveMinutes: "After 5 minutes"
    case .fifteenMinutes: "After 15 minutes"
    }
  }
  public var requireFoot: String {
    "While VibeField is locked, the app switcher shows its mark. Changing these asks \(biometric ? name : "for your passcode") first."
  }
  public var offFoot: String {
    "VibeField opens without \(name). Anyone holding this phone unlocked can open your agents’ terminals."
  }
  public static let noPasscodeFoot = "Set a passcode in iOS Settings to lock VibeField."
}
