import LocalAuthentication

/// WI-3 — the app's ask: LocalAuthentication's `.deviceOwnerAuthentication`, so Face ID or Touch ID asks first and
/// iOS's own passcode is the fallback (and the lockout's way back). Face ID shows the app's own reason, the Info.plist's
/// `NSFaceIDUsageDescription` (DESIGN.md §9: "VibeField uses Face ID so only you can open it on this device.");
/// Touch ID and the passcode show `reason`.
@MainActor
public final class DeviceOwnerAuthenticator: LockAuthenticator {
  public init() {}

  /// The method this phone has now (`method(canAsk:…)` reads LocalAuthentication's answers).
  public var method: LockMethod {
    let context = LAContext()
    var error: NSError?
    let canAsk = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    var biometricError: NSError?
    let biometric = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricError)
    return Self.method(
      canAsk: canAsk, askError: error?.code, biometric: biometric, biometricError: biometricError?.code,
      sensor: context.biometryType)
  }

  /// A biometric that is set up (or locked out, which the passcode answers) names itself; one that is not set up
  /// leaves the passcode; no passcode at all is `.none`. Only iOS's own word that no passcode is set reads `.none`:
  /// the lock stands down on it and keeps that, so any other refusal keeps the phone's method, and the ask answers
  /// it (a miss leaves the curtain and its Unlock).
  static func method(
    canAsk: Bool, askError: Int?, biometric: Bool, biometricError: Int?, sensor: LABiometryType
  ) -> LockMethod {
    if !canAsk && askError == LAError.passcodeNotSet.rawValue { return .none }
    let lockedOut = biometricError == LAError.biometryLockout.rawValue
    guard biometric || lockedOut else { return .passcode }
    switch sensor {
    case .faceID: return .faceID
    case .touchID: return .touchID
    default: return .passcode
    }
  }

  public func ask(reason: String) async -> LockAnswer {
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
      return error?.code == LAError.passcodeNotSet.rawValue ? .unavailable : .missed
    }
    return await withCheckedContinuation { (done: CheckedContinuation<LockAnswer, Never>) in
      context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { passed, failure in
        let code = (failure as NSError?)?.code
        done.resume(returning: passed ? .passed : code == LAError.passcodeNotSet.rawValue ? .unavailable : .missed)
      }
    }
  }
}
