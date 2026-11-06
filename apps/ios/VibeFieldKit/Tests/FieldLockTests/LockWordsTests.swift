import Testing

@testable import FieldLock

/// WI-3 — the lock's words (DESIGN.md §9 "The lock"): Face ID's as ruled, and every word naming the method the
/// phone has. The Touch ID swap and the passcode-only set are drafts pending James (the lane's notes; VF-PM, 01:02Z).
/// L4's word pass (2026-11-06): the four words that name the device take it as its platform names it, the noun the UI
/// layer reads from FieldDesign's `DeviceWord` ("iPhone", "iPad", "device"), since FieldLock imports no UI.
@Suite("the lock says §9's words, each naming the method this phone has")
struct LockWordsTests {
  @Test("Face ID: the way in's last step, the curtain and Settings › Lock, word for word")
  func faceID() {
    let w = LockWords(.faceID)
    #expect(w.step == "Face ID")
    #expect(w.offerTitle == "Lock VibeField with Face ID.")
    #expect(w.offerLine(device: "iPhone") == "This iPhone can type into your agents’ terminals. Face ID keeps that to you.")
    #expect(w.lockWith == "Lock with Face ID")
    #expect(LockWords.notNow == "Not now")
    #expect(LockWords.offerNote == "You can change this in Settings › Lock.")
    #expect(LockWords.lockedTitle == "VibeField is locked.")
    #expect(w.unlockWith == "Unlock with Face ID")
    #expect(w.passcodeToo(device: "iPhone") == "Your iPhone passcode works too.")
    #expect(LockWords.row == "Lock")
    #expect(LockWords.toggle == "Lock VibeField")
    #expect(w.toggleLine(device: "iPhone") == "Face ID opens VibeField. When Face ID can’t, your iPhone passcode does.")
    #expect(w.requireHead == "Require Face ID")
    #expect(
      LockDelay.allCases.map(LockWords.delay)
        == ["Immediately", "After 1 minute", "After 5 minutes", "After 15 minutes"])
    #expect(
      w.requireFoot
        == "While VibeField is locked, the app switcher shows its mark. Changing these asks Face ID first.")
    #expect(
      w.offFoot(device: "iPhone")
        == "VibeField opens without Face ID. Anyone holding this iPhone unlocked can open your agents’ terminals.")
    #expect(LockWords.noPasscodeFoot == "Set a passcode in iOS Settings to lock VibeField.")
  }

  @Test("the row says whether the lock is on")
  func rowValue() {
    #expect(LockWords.rowValue(isOn: true) == "On")
    #expect(LockWords.rowValue(isOn: false) == "Off")
  }

  @Test("Touch ID swaps the name, and says no Face ID anywhere")
  func touchID() {
    let w = LockWords(.touchID)
    #expect(w.step == "Touch ID")
    #expect(w.offerTitle == "Lock VibeField with Touch ID.")
    #expect(w.offerLine(device: "iPhone") == "This iPhone can type into your agents’ terminals. Touch ID keeps that to you.")
    #expect(w.lockWith == "Lock with Touch ID")
    #expect(w.unlockWith == "Unlock with Touch ID")
    #expect(w.passcodeToo(device: "iPhone") == "Your iPhone passcode works too.")
    #expect(w.toggleLine(device: "iPhone") == "Touch ID opens VibeField. When Touch ID can’t, your iPhone passcode does.")
    #expect(w.requireHead == "Require Touch ID")
    #expect(
      w.requireFoot
        == "While VibeField is locked, the app switcher shows its mark. Changing these asks Touch ID first.")
    #expect(
      w.offFoot(device: "iPhone")
        == "VibeField opens without Touch ID. Anyone holding this iPhone unlocked can open your agents’ terminals.")
    for word in Self.all(w, device: "iPhone") {
      #expect(!word.contains("Face ID"), "\(word)")
    }
  }

  @Test("a passcode-only phone: its own set, and no “works too”, since the passcode is the method")
  func passcode() {
    let w = LockWords(.passcode)
    #expect(w.step == "Passcode")
    #expect(w.offerTitle == "Lock VibeField with your passcode.")
    #expect(
      w.offerLine(device: "iPhone") == "This iPhone can type into your agents’ terminals. Your passcode keeps that to you.")
    #expect(w.lockWith == "Lock with passcode")
    #expect(w.unlockWith == "Unlock with passcode")
    #expect(w.passcodeToo(device: "iPhone") == nil)
    #expect(w.toggleLine(device: "iPhone") == "Your iPhone passcode opens VibeField.")
    #expect(w.requireHead == "Require passcode")
    #expect(
      w.requireFoot
        == "While VibeField is locked, the app switcher shows its mark. Changing these asks for your passcode first.")
    #expect(
      w.offFoot(device: "iPhone")
        == "VibeField opens without your passcode. Anyone holding this iPhone unlocked can open your agents’ terminals.")
    for word in Self.all(w, device: "iPhone") {
      #expect(!word.contains("Face ID") && !word.contains("Touch ID"), "\(word)")
    }
  }

  @Test("the ask's own reason, where iOS shows it (Touch ID, the passcode): one sentence for every method")
  func reason() {
    for method in [LockMethod.faceID, .touchID, .passcode] {
      #expect(LockWords(method).reason == "Only you can open VibeField on this device.")
    }
  }

  @Test("L4's word pass: the lock names the device as its platform does, and on an iPad no word says phone")
  func deviceNamed() {
    for method in [LockMethod.faceID, .touchID, .passcode] {
      for device in ["iPad", "device"] {
        for word in Self.all(LockWords(method), device: device) {
          #expect(!word.localizedCaseInsensitiveContains("phone"), "\(method) on \(device): \(word)")
        }
      }
    }
    let w = LockWords(.touchID)
    #expect(w.offerLine(device: "iPad") == "This iPad can type into your agents’ terminals. Touch ID keeps that to you.")
    #expect(w.passcodeToo(device: "iPad") == "Your iPad passcode works too.")
    #expect(w.toggleLine(device: "iPad") == "Touch ID opens VibeField. When Touch ID can’t, your iPad passcode does.")
    #expect(
      w.offFoot(device: "iPad")
        == "VibeField opens without Touch ID. Anyone holding this iPad unlocked can open your agents’ terminals.")
    #expect(LockWords(.passcode).toggleLine(device: "device") == "Your device passcode opens VibeField.")
  }

  private static func all(_ w: LockWords, device: String) -> [String] {
    [
      w.step, w.offerTitle, w.offerLine(device: device), w.lockWith, w.unlockWith, w.passcodeToo(device: device) ?? "",
      w.reason, w.toggleLine(device: device), w.requireHead, w.requireFoot, w.offFoot(device: device),
    ]
  }
}
