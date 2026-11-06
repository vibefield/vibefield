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
  /// When the scene went to the background: the time away counts from here.
  @ObservationIgnored private var leftAt: ContinuousClock.Instant?
  /// Our own ask is up: the inactive it causes is not the person going away.
  @ObservationIgnored private var askOpen = false

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
    if isOn && method == .none {
      // a lock that cannot ask must not hold the door: iOS itself opens without a passcode (§9)
      standDown()
    } else if isOn {
      // a launch with the lock on stands the curtain at once; the ask comes when the scene is active
      state = .waiting
    }
  }

  /// Whether the curtain stands: while locked, and while the scene is away with the lock on (WI-D6 A: the app
  /// switcher shows the launch picture while the lock is on, your last screen while it is off).
  public var covers: Bool { isOn && (state != .open || away) }

  /// Whether the way in may offer the lock as its last step (WI-D3 A): off, and a phone that can lock.
  public var canOffer: Bool { !isOn && method != .none }

  /// The words for this phone's method.
  public var words: LockWords { LockWords(method) }

  /// The switch's foot on the Lock page: its line while on, what off means while off, and why it cannot turn on
  /// on a phone with no passcode. `device` is `DeviceWord.noun`, the UI layer's (`LockWords`).
  public func switchFoot(device: String) -> String {
    if method == .none { return LockWords.noPasscodeFoot }
    return isOn ? words.toggleLine(device: device) : words.offFoot(device: device)
  }

  // MARK: The scene

  /// The scene's phase moved. Returns the ask it started, if any: a launch's, or a return's after the lock's time.
  @discardableResult
  public func phase(_ phase: LockPhase) -> Task<Void, Never>? {
    switch phase {
    case .background:
      if leftAt == nil { leftAt = now() }
      away = true
      return nil
    case .inactive:
      // iOS's own ask makes the app inactive too: that is not the person going away
      if !askOpen { away = true }
      return nil
    case .active:
      away = false
      var returning = false
      if let left = leftAt {
        leftAt = nil
        returning = true
        // the method can change in iOS Settings while VibeField is away
        method = authenticator.method
        if isOn && method == .none {
          standDown()
          return nil
        }
        if isOn && state == .open && now() - left >= delay.duration { state = .waiting }
      }
      // a launch's curtain asks once the scene is active; a return asks whatever curtain it finds standing (a miss
      // left there too). The sheet's own inactive and back is no return, so it never asks again on its own.
      guard state == .waiting || (returning && state == .missed) else { return nil }
      return Task { await self.unlock() }
    }
  }

  // MARK: The acts

  /// The corner's Lock now: the curtain at once, then the ask. Only while the lock is on.
  @discardableResult
  public func lockNow() -> Task<Void, Never>? {
    guard isOn, state == .open else { return nil }
    state = .waiting
    return Task { await self.unlock() }
  }

  /// Unlock with Face ID, and the ask a launch or a return makes.
  public func unlock() async {
    guard state == .waiting || state == .missed else { return }
    state = .asking
    switch await ask() {
    case .passed: state = .open
    case .missed: state = .missed
    case .unavailable: standDown()
    }
  }

  /// The switch, and the way in's Lock with Face ID. Either way it asks first (§9: "Changing these asks Face ID
  /// first"), and a miss or a Cancel leaves it as it was. Returns whether it changed.
  @discardableResult
  public func setOn(_ on: Bool) async -> Bool {
    guard on != isOn else { return true }
    guard await ask() == .passed else { return false }
    isOn = on
    keeping.lockOn = on
    return true
  }

  /// Require Face ID: Immediately, or after 1, 5 or 15 minutes. It asks first. Returns whether it changed.
  @discardableResult
  public func setDelay(_ delay: LockDelay) async -> Bool {
    guard delay != self.delay else { return true }
    guard await ask() == .passed else { return false }
    self.delay = delay
    keeping.lockDelay = delay
    return true
  }

  /// One ask, the method read fresh first: a phone with no passcode is never asked. One at a time: a second tap
  /// before iOS's own ask is up (the way in's Lock with Face ID) asks nothing, and changes nothing.
  private func ask() async -> LockAnswer {
    guard !askOpen else { return .missed }
    method = authenticator.method
    guard method != .none else { return .unavailable }
    askOpen = true
    defer { askOpen = false }
    return await authenticator.ask(reason: words.reason)
  }

  /// A lock that cannot ask stands down: VibeField opens, and the switch is off until a passcode is set.
  private func standDown() {
    isOn = false
    keeping.lockOn = false
    state = .open
  }
}
