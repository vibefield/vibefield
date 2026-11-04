import LocalAuthentication
import Testing

@testable import FieldLock

/// WI-3 — the phone's method, from LocalAuthentication's answers (`DeviceOwnerAuthenticator.method`). The lock stands
/// down on `.none` and keeps it off (§9), so `.none` takes iOS's own word that no passcode is set: any other refusal
/// keeps the phone's method, and the ask itself answers it (a miss leaves the curtain and its Unlock).
@Suite("the method: only iOS's word that no passcode is set reads as none, so nothing else turns the lock off")
@MainActor
struct LockMethodTests {
  private func method(
    canAsk: Bool = true, askError: LAError.Code? = nil, biometric: Bool = true, biometricError: LAError.Code? = nil,
    sensor: LABiometryType = .faceID
  ) -> LockMethod {
    DeviceOwnerAuthenticator.method(
      canAsk: canAsk, askError: askError?.rawValue, biometric: biometric, biometricError: biometricError?.rawValue,
      sensor: sensor)
  }

  @Test("no passcode set: none, and the lock stands down")
  func noPasscode() {
    #expect(method(canAsk: false, askError: .passcodeNotSet, biometric: false, biometricError: .passcodeNotSet) == .none)
  }

  @Test("any other refusal keeps the phone's method: the lock never stands down on it")
  func otherRefusal() {
    for code in [LAError.Code.notInteractive, .invalidContext, .systemCancel] {
      #expect(method(canAsk: false, askError: code, biometric: false, biometricError: code) == .passcode, "\(code)")
      #expect(method(canAsk: false, askError: code, biometric: true, sensor: .touchID) == .touchID, "\(code)")
    }
    #expect(method(canAsk: false, askError: nil, biometric: false) == .passcode)
  }

  @Test("a biometric set up, or locked out, names itself; one not set up leaves the passcode")
  func sensors() {
    #expect(method(sensor: .faceID) == .faceID)
    #expect(method(sensor: .touchID) == .touchID)
    #expect(method(biometric: false, biometricError: .biometryLockout, sensor: .faceID) == .faceID)
    #expect(method(biometric: false, biometricError: .biometryNotEnrolled, sensor: .faceID) == .passcode)
    #expect(method(sensor: .none) == .passcode)
  }
}
