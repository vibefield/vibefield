import FieldDesign
import Testing

@testable import FieldHome

/// IOS-10b — the Me menu's Theme row (theme-row, James on the page Settings in a Pocket, 2026-11-11; DESIGN.md §8
/// "The phone's corner", amended that day): the Mac's row at touch pitch, the one setting Settings › Appearance keeps.
@Suite("the Me menu's Theme row: above Settings…, above Lock now, Light · Dark · Auto")
struct ThemeMenuRowTests {
  @Test("the rows above the desktops, top to bottom: Theme above Settings…, and above Lock now while the lock is on")
  func order() {
    #expect(
      AccountCornerView.menuRows(canSignOut: true, offersSignIn: false, lockOn: true)
        == [.signOut, .theme, .lockNow, .settings])
    #expect(
      AccountCornerView.menuRows(canSignOut: true, offersSignIn: false, lockOn: false)
        == [.signOut, .theme, .settings])
    #expect(
      AccountCornerView.menuRows(canSignOut: true, offersSignIn: true, lockOn: false)
        == [.signOut, .signIn, .theme, .settings])
    #expect(
      AccountCornerView.menuRows(canSignOut: false, offersSignIn: true, lockOn: false)
        == [.signIn, .theme, .settings])
    // Lock now keeps its place just above Settings… (WI-3), and Theme is never below it
    for lockOn in [true, false] {
      let rows = AccountCornerView.menuRows(canSignOut: true, offersSignIn: true, lockOn: lockOn)
      #expect(rows.last == .settings)
      #expect(rows.filter { $0 == .theme }.count == 1)
      if lockOn { #expect(rows.firstIndex(of: .theme)! < rows.firstIndex(of: .lockNow)!) }
    }
  }

  @Test("its control is the Mac's three words, the one setting Settings › Appearance keeps")
  func words() {
    #expect(PhoneAppearance.allCases.map(\.word) == ["Light", "Dark", "Auto"])
    #expect(ThemeMenuRow.storageKey == PhoneAppearance.storageKey)
  }

  @Test("its glyph is the sun, or the moon by night, as the Mac's row wears them")
  func glyph() {
    #expect(ThemeMenuRow.glyph(dark: false) == "sun.max")
    #expect(ThemeMenuRow.glyph(dark: true) == "moon")
  }
}
