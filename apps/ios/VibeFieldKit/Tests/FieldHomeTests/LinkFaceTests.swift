import Testing

@testable import FieldHome
@testable import FieldMesh

/// The bug this suite exists for: `FieldLink` has published `desktops`,
/// `notes` and `isHearing` since IOS-4b and `HomeScreen` read only `agents`,
/// so a desktop whose door REFUSED this phone, one on the mesh serving no
/// product surface, and one still dialing all produced the same picture — a
/// field reading "NO ACTIVE AGENTS" with nothing saying why.
///
/// The vocabulary is `MeshDisplay`'s and stays pinned there. What is pinned
/// HERE is the corner's own two rules: the token and the line are always about
/// the SAME desktop, and a desktop that answered and has sent nothing still
/// explains the empty field.
@Suite("the corner says why the field is empty")
struct LinkFaceTests {
  private func desktop(
    id: String = "dev-1",
    name: String = "studio",
    state: FieldDesktop.State,
    feed: FieldFeedSource = .none
  ) -> FieldDesktop {
    FieldDesktop(deviceId: id, name: name, platform: "darwin", state: state, feed: feed)
  }

  @Test("nobody has been asked, so there is nothing to say")
  func noDesktops() {
    #expect(FieldHomeModel.linkFace(desktops: [], isHearing: false) == .quiet)
  }

  /// The one face a person can act on, and the one the review found silent.
  @Test("a refused door takes the corner, in the door's own words")
  func refusedDoor() {
    let refused = desktop(state: .failed("FORBIDDEN_SCOPE"))
    let face = FieldHomeModel.linkFace(desktops: [refused], isHearing: false)
    #expect(face.token == "DOOR")
    #expect(face.wantsAttention)
    #expect(face.line == "studio — refused: FORBIDDEN_SCOPE")
  }

  /// EL7 M1's other refusal: the desktop IS serving, and what it published is
  /// not itself. `linkLabel` and `chipWantsAttention` count it exactly like a
  /// door that said no, so the corner's subject has to as well.
  @Test("a door this phone would not dial takes the corner too")
  func doorThisPhoneRefusedToDial() {
    let refused = desktop(state: .refusedDoor("published host is not on this tailnet"))
    let face = FieldHomeModel.linkFace(desktops: [refused], isHearing: false)
    #expect(face.token == "DOOR")
    #expect(face.wantsAttention)
    #expect(face.line == MeshDisplay.linkLine(desktop: refused))
    #expect(face.line != MeshDisplay.linkLine(desktop: desktop(state: .failed("x"))))
  }

  /// The two refusals are one token, so whichever comes first is the subject —
  /// never a "DOOR" token over a line about the healthy desktop between them.
  @Test("either refusal outranks a ready desktop")
  func eitherRefusalWins() {
    let live = desktop(id: "a", name: "studio", state: .ready, feed: .store)
    for refusal in [
      FieldDesktop.State.failed("no route to host"),
      .refusedDoor("published host is not on this tailnet"),
    ] {
      let bad = desktop(id: "b", name: "loft", state: refusal)
      let face = FieldHomeModel.linkFace(desktops: [live, bad], isHearing: true)
      #expect(face.token == "DOOR")
      #expect(face.wantsAttention)
      #expect(face.line == MeshDisplay.linkLine(desktop: bad))
    }
  }

  @Test("a desktop on the mesh that serves no product surface says so")
  func noDoor() {
    let quiet = desktop(state: .noDoor)
    let face = FieldHomeModel.linkFace(desktops: [quiet], isHearing: false)
    #expect(face.token == "NO DOOR")
    #expect(!face.wantsAttention)
    #expect(face.line == MeshDisplay.linkLine(desktop: quiet))
  }

  @Test("a desktop still dialing is a state, not a blank")
  func dialing() {
    for state in [FieldDesktop.State.connecting, .reconnecting] {
      let dialing = desktop(state: state)
      let face = FieldHomeModel.linkFace(desktops: [dialing], isHearing: false)
      #expect(face.token == "…")
      #expect(!face.wantsAttention)
      #expect(face.line == MeshDisplay.linkLine(desktop: dialing))
    }
  }

  /// Silence is the healthy answer: the bodies on the screen are the word.
  @Test("a desktop that is feeding needs no word")
  func readyAndHearing() {
    let live = desktop(state: .ready, feed: .store)
    #expect(FieldHomeModel.linkFace(desktops: [live], isHearing: true) == .quiet)
  }

  /// THE regression `isHearing` exists for. `MeshDisplay.linkLabel` goes
  /// silent the moment any desktop is ready, which is right for the token and
  /// leaves a field with no bodies and no explanation — so the line speaks
  /// instead, and the token still says nothing.
  @Test("a desktop that answered and sent nothing still explains the empty field")
  func readyAndSilent() {
    let silent = desktop(state: .ready, feed: .none)
    let face = FieldHomeModel.linkFace(desktops: [silent], isHearing: false)
    #expect(face.token == nil)
    #expect(!face.wantsAttention)
    #expect(face.line == "studio — connected · no field yet")
  }

  /// A token reading "DOOR" over a line about a different desktop would be
  /// worse than either alone, so the precedences are the same one.
  @Test("the token and the line are about the same desktop")
  func tokenAndLineAgree() {
    let refused = desktop(id: "dev-2", name: "loft", state: .failed("no route to host"))
    let live = desktop(id: "dev-1", name: "studio", state: .ready, feed: .store)
    let face = FieldHomeModel.linkFace(desktops: [live, refused], isHearing: true)
    #expect(face.token == "DOOR")
    #expect(face.wantsAttention)
    #expect(face.line == MeshDisplay.linkLine(desktop: refused))
    #expect(FieldHomeModel.linkSubject(desktops: [live, refused], isHearing: true) == refused)
  }

  /// Every token the corner can draw comes with a sentence naming its
  /// subject. A badge with nothing under it would be the blank again, shorter.
  @Test("a token never appears without its line")
  func tokenNeverAlone() {
    let cases: [[FieldDesktop]] = [
      [desktop(state: .failed("refused"))],
      [desktop(state: .refusedDoor("not on this tailnet"))],
      [desktop(state: .noDoor)],
      [desktop(state: .connecting)],
      [desktop(state: .reconnecting)],
      [desktop(state: .ready, feed: .door)],
      [desktop(id: "a", state: .noDoor), desktop(id: "b", state: .connecting)],
    ]
    for desktops in cases {
      for hearing in [true, false] {
        let face = FieldHomeModel.linkFace(desktops: desktops, isHearing: hearing)
        if face.token != nil { #expect(face.line != nil) }
      }
    }
  }
}

/// The two bugs in `openLink`: a second caller inside the `await mesh.node`
/// window built a second `FieldLink` and stranded the first, and the DEBUG
/// guard beside it tested two flags the fixture link does not set.
@Suite("opening the field's link")
struct LinkOpenActionTests {
  @Test("with nothing standing, open one")
  func opensWhenAbsent() {
    #expect(
      FieldHomeModel.linkOpenAction(fixtureOwnsLink: false, hasLink: false, isOpening: false)
        == .open)
  }

  /// THE regression: the second caller inside the await window must not build
  /// a second link — the first will install one.
  @Test("an open already in flight is not opened again")
  func inFlightIsHeld() {
    #expect(
      FieldHomeModel.linkOpenAction(fixtureOwnsLink: false, hasLink: false, isOpening: true)
        == .none)
  }

  @Test("a link already standing is resumed, never rebuilt")
  func standingIsResumed() {
    #expect(
      FieldHomeModel.linkOpenAction(fixtureOwnsLink: false, hasLink: true, isOpening: false)
        == .resume)
  }

  /// A fixture link has no live door behind it: resuming it is a no-op and
  /// replacing it is the fixture lying about what it is.
  @Test("a fixture link is left alone")
  func fixtureWins() {
    for opening in [true, false] {
      #expect(
        FieldHomeModel.linkOpenAction(fixtureOwnsLink: true, hasLink: true, isOpening: opening)
          == .none)
    }
  }
}
