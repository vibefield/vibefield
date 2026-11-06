import FieldDesign
import FieldLock
import FieldSplash
import SwiftUI

/// The phone's root: the splash over the home at launch (DESIGN.md §8 "The phone's splash"), the home
/// mounted under it once the field shows. The window wears the phone's Appearance from the first
/// frame here, before the home that also applies it is built, so the splash comes up in the
/// appearance the home will wear (Obsidian by night, Obsidian Light by day) and never turns over.
///
/// WI-3 — and the lock (DESIGN.md §9 "The lock"): the root holds it, tells it the scene's phase, and stands its
/// curtain (`LockCurtain`), a window over everything the home shows, the home's sheets among them.
public struct HomeRoot: View {
  @AppStorage(PhoneAppearance.storageKey) private var phoneLook: PhoneAppearance = .auto
  @Environment(\.scenePhase) private var scenePhase
  @State private var lock = HomeRoot.makeLock()

  public init() {}

  public var body: some View {
    #if DEBUG
      // IOS-12e: `-vf-spark-gallery` is the spark gallery instead of the app, and `-vf-reduce-motion` puts the whole
      // app under reduced motion, which simctl cannot turn on. SwiftUI's `accessibilityReduceMotion` is get-only; its
      // setter is `_accessibilityReduceMotion` (SwiftUICore's interface).
      let arguments = ProcessInfo.processInfo.arguments
      let reduceMotion = SparkGalleryRequest.reducesMotion(arguments)
      Group {
        if let gallery = SparkGalleryRequest(arguments: arguments) {
          SparkGallery(request: gallery)
        } else {
          root
        }
      }
      .transformEnvironment(\._accessibilityReduceMotion) { if reduceMotion { $0 = true } }
    #else
      root
    #endif
  }

  private var root: some View {
    SplashGate { HomeScreen(lock: lock) }
      .phoneAppearance(phoneLook)
      .background {
        LockCurtain(
          covers: lock.covers, state: lock.state, method: lock.method, active: scenePhase != .background,
          look: phoneLook, onUnlock: { Task { await lock.unlock() } })
      }
      .onAppear { lock.phase(LockPhase(scenePhase)) }
      .onChange(of: scenePhase) { _, phase in lock.phase(LockPhase(phase)) }
  }

  /// The app's lock: LocalAuthentication's ask, the settings in UserDefaults. A Debug run with `-vf-lock=<method>`
  /// stamps the lock for a photograph (README).
  private static func makeLock() -> FieldLock {
    #if DEBUG
      if let stamped = LockFixtures.stamped() { return stamped }
    #endif
    return FieldLock(authenticator: DeviceOwnerAuthenticator(), keeping: DefaultsLockKeeping())
  }
}

extension LockPhase {
  init(_ phase: ScenePhase) {
    switch phase {
    case .active: self = .active
    case .background: self = .background
    default: self = .inactive
    }
  }
}

#if DEBUG
  /// `-vf-lock=<faceid|touchid|passcode|none>[-open]` (WI-3): the lock on, on a phone with that method, its settings
  /// kept in memory, never in the phone's own; it cannot run in Release. Every ask misses, so a screenshot run
  /// photographs the curtain after a miss in each method's words. With `-open` every ask passes, so Settings › Lock can
  /// be photographed with the lock on: no script passes the real ask, and no agent injects input. `none` is a phone
  /// with no passcode: the lock stands down at launch, and Settings › Lock shows its switch dimmed over §9's foot. Any
  /// other value stamps nothing.
  ///
  /// (Corrected 2026-11-04, WI-3's review pass: this said that a simulator has no passcode, so the real lock stands
  /// down there. The photographs at `8a3804658` showed otherwise: the iPhone 17 Pro simulator answers as a
  /// passcode-only phone, and its Settings › Lock showed the passcode set's off foot.)
  @MainActor
  enum LockFixtures {
    static let argument = "-vf-lock="

    static func stamped() -> FieldLock? {
      guard let value = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(argument) })?.dropFirst(argument.count)
      else { return nil }
      let open = value.hasSuffix("-open")
      let method: LockMethod
      switch open ? value.dropLast("-open".count) : value {
      case "faceid": method = .faceID
      case "touchid": method = .touchID
      case "passcode": method = .passcode
      case "none": method = .none
      default: return nil
      }
      return FieldLock(authenticator: Stamped(method, answer: open ? .passed : .missed), keeping: Kept())
    }

    final class Stamped: LockAuthenticator {
      let method: LockMethod
      let answer: LockAnswer
      init(_ method: LockMethod, answer: LockAnswer) {
        self.method = method
        self.answer = answer
      }
      func ask(reason: String) async -> LockAnswer { answer }
    }

    final class Kept: LockKeeping {
      var lockOn = true
      var lockDelay: LockDelay? = .oneMinute
    }
  }
#endif
