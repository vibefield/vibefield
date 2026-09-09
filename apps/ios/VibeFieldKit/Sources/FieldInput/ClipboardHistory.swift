import Foundation
import Observation

/// The last twenty things pasted THROUGH this card.
///
/// **What it is not.** It is not a clipboard monitor. Nothing here samples
/// `UIPasteboard.general.string`, on a timer or otherwise: reading the
/// pasteboard's contents is what raises the system's "allow paste?" alert, and
/// an app that polls for it is surveillance the OS is right to announce. Every
/// entry in this ring arrived because the user tapped a paste control and
/// handed it over — the same grant `PasteChip` is built on, recorded after the
/// fact rather than harvested before it.
///
/// It is therefore a history of THIS CARD, not of the phone, and the sheet
/// says so in the empty state.
@MainActor
@Observable
public final class ClipboardHistory {

  public static let defaultsKey = "vf.input.clipboardHistory"

  /// Twenty. Long enough that the thing you copied three sessions ago is
  /// still there, short enough that the sheet is a list rather than an
  /// archive — and short enough that what the app keeps of the user's
  /// clipboard stays a number a person can hold in their head.
  public static let capacity = 20

  /// Newest first.
  public private(set) var entries: [String] = []

  @ObservationIgnored private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    self.entries = defaults.stringArray(forKey: Self.defaultsKey) ?? []
  }

  /// Take one, newest first, at the cap.
  ///
  /// De-duplication is deliberately against the WHOLE ring rather than only
  /// its head: pasting the same error twice with something else in between is
  /// one thing the user has, not two, and a ring full of the same line is a
  /// ring with nothing in it. The repeat moves to the front, because that is
  /// when it was last wanted.
  public func record(_ text: String) {
    guard !text.isEmpty else { return }
    entries.removeAll { $0 == text }
    entries.insert(text, at: 0)
    if entries.count > Self.capacity {
      entries.removeLast(entries.count - Self.capacity)
    }
    save()
  }

  public func delete(atOffsets offsets: IndexSet) {
    entries.remove(atOffsets: offsets)
    save()
  }

  public func delete(_ text: String) {
    entries.removeAll { $0 == text }
    save()
  }

  /// CLEAR. One act, no confirmation: nothing is lost that the user did not
  /// already have somewhere else, and a sheet asking "are you sure" about
  /// forgetting is the app arguing for keeping it.
  public func clear() {
    entries = []
    save()
  }

  private func save() {
    defaults.set(entries, forKey: Self.defaultsKey)
  }
}
