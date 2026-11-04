import Foundation
import Observation

/// How this phone proves it is you (DESIGN.md §9 "The lock": every word names the method the phone has).
public enum LockMethod: Equatable, Sendable {
  case faceID
  case touchID
  /// A passcode, with neither Face ID nor Touch ID set up.
  case passcode
  /// No passcode set: the phone cannot lock (§9: "Set a passcode in iOS Settings to lock VibeField.").
  case none
}

/// How long VibeField may be away before the lock asks again (WI-D4 A: a minute to start; Settings offers four).
public enum LockDelay: Int, CaseIterable, Sendable {
  case immediately = 0
  case oneMinute = 60
  case fiveMinutes = 300
  case fifteenMinutes = 900

  public var duration: Duration { .seconds(rawValue) }
}

/// What one ask came back with.
public enum LockAnswer: Equatable, Sendable {
  case passed
  /// A miss or a Cancel, the person's or the system's.
  case missed
  /// The phone cannot ask: no passcode is set.
  case unavailable
}

/// The scene's phase, in the lock's own terms: FieldLock names no SwiftUI.
public enum LockPhase: Equatable, Sendable {
  case active
  case inactive
  case background
}

/// The ask itself. The app's is LocalAuthentication's `.deviceOwnerAuthentication` (`DeviceOwnerAuthenticator`), so
/// the passcode is iOS's own fallback; a test answers its own.
@MainActor
public protocol LockAuthenticator: AnyObject {
  /// The method the phone has now: it can change in iOS Settings while VibeField is away.
  var method: LockMethod { get }
  func ask(reason: String) async -> LockAnswer
}

/// Where the lock's two settings are kept: the app's are UserDefaults' (`DefaultsLockKeeping`).
@MainActor
public protocol LockKeeping: AnyObject {
  var lockOn: Bool { get set }
  /// Nil until a delay is chosen: the lock starts at a minute (WI-D4 A).
  var lockDelay: LockDelay? { get set }
}

/// The lock's settings in UserDefaults: a phone preference (Settings › This phone), so a sign-out leaves them.
@MainActor
public final class DefaultsLockKeeping: LockKeeping {
  public static let onKey = "vf.lock.on"
  public static let delayKey = "vf.lock.delay"
  private let defaults: UserDefaults

  public init(_ defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public var lockOn: Bool {
    get { defaults.bool(forKey: Self.onKey) }
    set { defaults.set(newValue, forKey: Self.onKey) }
  }

  public var lockDelay: LockDelay? {
    get { (defaults.object(forKey: Self.delayKey) as? Int).flatMap(LockDelay.init(rawValue:)) }
    set { defaults.set(newValue?.rawValue, forKey: Self.delayKey) }
  }
}

/// WI-3 — the lock (DESIGN.md §9 "The lock"; WI-D3…D7 A, WI-L5…L7). The scene's phases, a clock and an ask go in;
/// whether the curtain stands, and what it says, come out. The curtain that draws it is FieldHome's.
@MainActor
@Observable
public final class FieldLock {
  public enum State: Equatable, Sendable {
    /// Nothing of yours is covered by the lock.
    case open
    /// The curtain stands and the ask is coming (a launch, a return, Lock now).
    case waiting
    /// The system's own ask is up over the curtain.
    case asking
    /// A miss or a Cancel: the curtain says so, with its one act.
    case missed
  }

  public private(set) var isOn: Bool
  public private(set) var delay: LockDelay
  public private(set) var state: State = .open
  /// The method, as last read: on each return and before each ask.
  public private(set) var method: LockMethod
  /// Whether the scene is away from the person (inactive or in the background), iOS's own ask aside.
  public private(set) var away = false

  @ObservationIgnored private let authenticator: any LockAuthenticator
  @ObservationIgnored private let keeping: any LockKeeping
  @ObservationIgnored private let now: @MainActor () -> ContinuousClock.Instant

  public init(
    authenticator: any LockAuthenticator, keeping: any LockKeeping,
    now: @escaping @MainActor () -> ContinuousClock.Instant = { ContinuousClock.now }
  ) {
    self.authenticator = authenticator
    self.keeping = keeping
    self.now = now
    method = authenticator.method
    isOn = keeping.lockOn
    delay = keeping.lockDelay ?? .oneMinute
  }

  /// Whether the curtain stands.
  public var covers: Bool { false }

  /// Whether the way in may offer the lock as its last step (WI-D3 A).
  public var canOffer: Bool { false }

  /// The words for this phone's method.
  public var words: LockWords { LockWords(method) }

  /// The switch's foot on the Lock page.
  public var switchFoot: String { "" }

  // MARK: The scene

  /// The scene's phase moved. Returns the ask it started, if any.
  @discardableResult
  public func phase(_ phase: LockPhase) -> Task<Void, Never>? {
    nil
  }

  // MARK: The acts

  /// The corner's Lock now. Returns the ask it started, if any.
  @discardableResult
  public func lockNow() -> Task<Void, Never>? {
    nil
  }

  /// Unlock with Face ID, and the ask a launch or a return makes.
  public func unlock() async {}

  /// The switch, and the way in's Lock with Face ID. Returns whether it changed.
  @discardableResult
  public func setOn(_ on: Bool) async -> Bool {
    false
  }

  /// Require Face ID: Immediately, or after 1, 5 or 15 minutes. Returns whether it changed.
  @discardableResult
  public func setDelay(_ delay: LockDelay) async -> Bool {
    false
  }
}
