import UIKit

/// IOS-13a (DESIGN.md §9 "The phone's legal words"; Q1, VF-PM 2026-11-05 02:29Z) — the device, named as its platform
/// names it, read when VibeField runs: "this iPhone", "this iPad", and "this device" where it is neither (the bible's
/// §7 platform label, with LP-4's "this device" as the fallback). The ONE place a Settings or way-in word names the
/// device: every sentence takes it from here, by substitution, so nothing names a phone by hand.
///
/// It lives in FieldDesign, the leaf every UI module imports (VF-PM 2026-11-05 03:59Z, ruled (a); Q1 had named
/// FieldSettings), so FieldTerminal's Settings › Terminal reaches it too, and L4's word pass after 13a takes it from
/// here: one word, one home.
public enum DeviceWord: Equatable, Sendable {
  case iPhone
  case iPad
  /// Neither: a Mac, Vision Pro, CarPlay, or an idiom iOS has not named yet.
  case unknown

  public init(_ idiom: UIUserInterfaceIdiom) {
    switch idiom {
    case .phone: self = .iPhone
    case .pad: self = .iPad
    default: self = .unknown
    }
  }

  /// This device's word, read once from UIKit.
  @MainActor public static let current = DeviceWord(UIDevice.current.userInterfaceIdiom)

  /// "iPhone", "iPad", "device".
  public var noun: String {
    switch self {
    case .iPhone: "iPhone"
    case .iPad: "iPad"
    case .unknown: "device"
    }
  }

  /// "this iPhone", within a sentence.
  public var this: String { "this \(noun)" }
  /// "This iPhone", at a sentence's start, as a head, or as a tag.
  public var This: String { "This \(noun)" }
}
