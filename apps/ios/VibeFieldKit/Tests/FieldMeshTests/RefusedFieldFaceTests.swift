import Testing

@testable import FieldMesh

/// UA-P-1d — the refusal that had nowhere to go, arriving at a face.
///
/// `FieldLink` has carried a door's field-subscription refusal since IOS-4b and
/// carried it to `notes`, which no view reads. A desktop whose door answered
/// hello and then refused the board therefore drew "connected · no field yet"
/// over an empty field — the honest sentence, hiding the honest reason — and
/// wore a healthy chip while it did. These rows are the corner reading it.
///
/// They are display rows and want no rig: the mechanism (the reason reaching
/// `FieldDesktop.fieldRefusal`) is witnessed over the real join in
/// `FieldLinkFieldRefusalTests`, and this is the half that turns it into words.
@Suite struct RefusedFieldFaceTests {
  private func refused(_ reason: String) -> FieldDesktop {
    FieldDesktop(
      deviceId: "dev-studio", name: "studio", platform: "darwin", state: .ready,
      feed: FieldFeedSource.none, fieldRefusal: reason)
  }

  /// ONE PREDICATE. The token, the chip's contrast and the corner's subject all
  /// ask the same function, so a token reading "DOOR" over a line about a
  /// different desktop is not a thing that can happen.
  @Test func aRefusedFieldWantsTheUser() {
    let desktop = refused("FORBIDDEN_SCOPE")
    #expect(MeshDisplay.wantsTheUser(desktop))
    #expect(MeshDisplay.linkLabel(desktops: [desktop]) == "DOOR")
    #expect(MeshDisplay.chipWantsAttention(desktops: [desktop]))
  }

  /// The door's words, verbatim, and they OUTRANK the feed: the refusal is the
  /// reason there is no feed, so "connected · no field yet" would be the true
  /// sentence with the useful half removed.
  @Test func theLineCarriesTheDoorsOwnReason() {
    #expect(
      MeshDisplay.linkLine(desktop: refused("FORBIDDEN_SCOPE"))
        == "studio — connected · the field was refused: FORBIDDEN_SCOPE")
  }

  /// And a desktop with no refusal is unchanged — the quiet chip is still the
  /// healthy answer.
  @Test func aDesktopWithNoRefusalIsUntouched() {
    let healthy = FieldDesktop(
      deviceId: "dev-studio", name: "studio", platform: "darwin", state: .ready,
      feed: .door)
    #expect(!MeshDisplay.wantsTheUser(healthy))
    #expect(MeshDisplay.linkLabel(desktops: [healthy]) == nil)
    #expect(MeshDisplay.linkLine(desktop: healthy) == "studio — connected · field over the door")
  }
}
