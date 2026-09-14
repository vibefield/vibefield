import FieldMesh
import FieldTerminal
import SwiftUI

/// Everything on the home screen that is a DECISION rather than a layout, kept
/// out of the views so it can be tested without a simulator — the shape
/// `TerminalSettingsModel` established on the terminal leg.
///
/// Each function here replaced a rule that was previously spelled out inline
/// across `HomeScreen`/`SessionCardView` and got it wrong; the doc comments
/// carry the finding, and `FieldHomeTests` pins it.
enum FieldHomeModel {

  // MARK: - Discovery

  /// What one change in (mesh, scene phase) means for the remote-session poll.
  ///
  /// The two stoppers are deliberately different verbs, and conflating them was
  /// the bug. Backgrounding **parks** a field whose door is still good: the
  /// Truffle runtime did not go anywhere, so the rows stay on screen and the
  /// poll resumes on return. A mesh that left **closes the door**:
  /// `MeshModel.connect()` builds a fresh runtime, so the directory the field
  /// was holding names a node that no longer exists, and keeping its rows would
  /// be the stage claiming a mesh answered when none did.
  ///
  /// Previously `.background` called `stop()` on the field but left the
  /// "already polling" flag set, so the resume branch was unreachable for the
  /// rest of the process's life: bubbles froze, and `noteHostReachable()` —
  /// the ONLY thing in this app that can end a `suspended(host absent)`
  /// attachment — could never fire again.
  enum DiscoveryAction: Equatable {
    /// Drop the source and the rows: the answer they came from is void.
    case closeDoor
    /// Stop the poll, keep the field standing: the door is still good.
    case park
    /// Build a source from the live directory and start polling.
    case open
    /// Restart the poll on the field that is already standing.
    case resume
    case none
  }

  static func discoveryAction(
    meshIsUp: Bool,
    phase: ScenePhase,
    polling: Bool,
    hasDoor: Bool
  ) -> DiscoveryAction {
    // Every stopper is a no-op when there is nothing to stop. Closing a door
    // that is not there is not honesty, it is churn: this runs on every mesh
    // AND scene tick, and an unconditional close would rebuild the field object
    // (and re-publish its snapshot) for changes that concern it not at all.
    guard meshIsUp else { return (hasDoor || polling) ? .closeDoor : .none }
    // `.inactive` is transient on iOS (a notification shade, the app switcher's
    // first frame); parking there would flap, so only a real background parks.
    if phase == .background { return polling ? .park : .none }
    guard phase == .active, !polling else { return .none }
    return hasDoor ? .resume : .open
  }

  // MARK: - The field's own leg (IOS-4e)

  /// What the corner says about the doors, in the three parts the corner
  /// draws: the chip's second token, whether it wants the user, and the
  /// sentence under it naming the desktop the token is about.
  ///
  /// Every word here comes from `MeshDisplay`, which has owned this vocabulary
  /// and its tests since IOS-4b. What this function adds is the thing
  /// `MeshDisplay.linkLabel` cannot see from its own signature — WHICH desktop
  /// the token is about, and the one state a token deliberately stays silent
  /// through.
  struct LinkFace: Equatable {
    /// `MeshDisplay.linkLabel`, verbatim. Nil is the healthy answer: a desktop
    /// that is ready and feeding needs no word, because the bodies on the
    /// screen already are the word.
    var token: String?
    var wantsAttention: Bool
    /// `MeshDisplay.linkLine` for the subject, or nil when there is nothing to
    /// explain.
    var line: String?

    static let quiet = LinkFace(token: nil, wantsAttention: false, line: nil)
  }

  /// The corner's whole answer about the doors.
  ///
  /// `isHearing` is why this takes two arguments. `linkLabel` goes silent the
  /// moment ANY desktop is `.ready`, which is right for the token and not
  /// enough for the corner: a desktop that answered and has sent no board is
  /// `FieldLink`'s own documented "they are there and saying nothing", and
  /// with no bodies on the field that is the blank again wearing a healthy
  /// chip. So the token still says nothing — the vocabulary is MeshDisplay's
  /// and this does not overrule it — and the LINE appears instead, which is
  /// the one place that fact has ever been written down ("connected · no field
  /// yet").
  static func linkFace(desktops: [FieldDesktop], isHearing: Bool) -> LinkFace {
    guard let subject = linkSubject(desktops: desktops, isHearing: isHearing) else {
      return .quiet
    }
    return LinkFace(
      token: MeshDisplay.linkLabel(desktops: desktops),
      wantsAttention: MeshDisplay.chipWantsAttention(desktops: desktops),
      line: MeshDisplay.linkLine(desktop: subject))
  }

  /// The desktop the corner is about, in `linkLabel`'s own precedence — a
  /// refusal first, then the ready one, then whoever is dialing, then the
  /// desktops that publish no door at all. The two must not disagree: a token
  /// reading "DOOR" over a line about a different desktop would be worse than
  /// either alone.
  static func linkSubject(desktops: [FieldDesktop], isHearing: Bool) -> FieldDesktop? {
    // Both refusals, because `linkLabel` and `chipWantsAttention` count both:
    // a door that said no, and a door this phone would not dial (EL7 M1). They
    // are different sentences and the same token, and the subject has to be
    // whichever one the token is about.
    if let refused = desktops.first(where: {
      switch $0.state {
      case .failed, .refusedDoor: true
      default: false
      }
    }) {
      return refused
    }
    if let ready = desktops.first(where: { $0.state == .ready }) {
      // Silence is the healthy answer only while something is actually
      // arriving. `isHearing` is the whole difference between a quiet field
      // and an empty one.
      return isHearing ? nil : ready
    }
    if let dialing = desktops.first(where: {
      $0.state == .connecting || $0.state == .reconnecting
    }) {
      return dialing
    }
    // Every desktop published a slice and none is serving a door.
    return desktops.first
  }

  // MARK: - The link's own door

  /// What a call to open the field's link should actually do.
  ///
  /// Two bugs live here and both were invisible because the rule was spelled
  /// inline. `openLink` read `link == nil`, then awaited the mesh node, then
  /// assigned — so two calls inside that window (a scene-phase flap reaches it
  /// through discovery) each built a `FieldLink`, each with two `FieldStore`s
  /// and its own sockets, and the second overwrote the first with nothing left
  /// holding it to stop it. And the DEBUG guard beside it tested the two flags
  /// the fixture LINK does not set (`-vf-demo-field-slice` sets neither), so
  /// its only effect was skipping a resume for the two paths that own the
  /// field's rows rather than its link.
  enum LinkOpenAction: Equatable {
    /// Nothing to do: a fixture owns the link, or an open is already in
    /// flight and will install one.
    case none
    /// A link is standing; unpause it.
    case resume
    /// Build one.
    case open
  }

  static func linkOpenAction(
    fixtureOwnsLink: Bool, hasLink: Bool, isOpening: Bool
  ) -> LinkOpenAction {
    // A fixture link has no live door behind it: resuming it is a no-op and
    // replacing it is the fixture lying about what it is.
    if fixtureOwnsLink { return .none }
    if hasLink { return .resume }
    return isOpening ? .none : .open
  }

  // MARK: - The session card's face

  /// Which face the session card wears.
  ///
  /// The field's listing is NOT the authority on whether a session is alive
  /// while one is attached. `remoteFailureTolerance` withdraws every row after
  /// two consecutive failed asks — roughly four seconds at the poll's cadence,
  /// and with a single desktop on the mesh a single refused listing is already
  /// a failed ask — but a terminal that is still rendering frames has not ended
  /// because a listing timed out. So an attached card keeps its subject and
  /// lets the connection speak for itself.
  ///
  /// Only an UNATTACHED card has nothing better than the listing to go on, and
  /// there the row's departure is the only signal there is — so it stays the
  /// ended face, which is what it always was.
  enum CardFace: Equatable {
    case session
    case ended
  }

  static func cardFace(hasSubject: Bool, listed: Bool, attached: Bool) -> CardFace {
    guard hasSubject else { return .ended }
    return (listed || attached) ? .session : .ended
  }

  // MARK: - The input card

  /// Whether the input card is on the screen at all (K-D2).
  ///
  /// It is shown for exactly one state: a LIVE attachment the host has granted
  /// writes to. Every other state renders no card — not a greyed-out one.
  /// A rail of keys that cannot reach a terminal is the disabled-affordance
  /// shape D-i6 exists to forbid: the honest line ("view only — this device
  /// has no write key for this host") already says why, and a dead keyboard
  /// under it would say it a second time and worse.
  ///
  /// `acceptsInput` alone would very nearly do — the attachment composes it
  /// from the live phase and the grant — but the phase is asked for again
  /// here so this stays a total function of what the card can see, and so a
  /// suspended session cannot keep a keyboard up on a stale `true`.
  enum InputCardFace: Equatable {
    case hidden
    case shown
  }

  static func inputCardFace(phase: TerminalPhase, acceptsInput: Bool) -> InputCardFace {
    guard phase == .live, acceptsInput else { return .hidden }
    return .shown
  }

  // MARK: - Writes

  /// What the card can say about typing BEFORE a tap, which since TM-3
  /// (2026-09-14) is one fact rather than two.
  ///
  /// `sessionSharesWrites` rides in the listing — a broadcast with no
  /// per-caller context — so it says the session is *shared* for writing, never
  /// that WE may write. Whether this device may type is decided per attach, and
  /// it used to depend on a mirror-write key this phone either held or did not:
  /// a second fact, a sheet to enter it, and an ENTER KEY affordance beside this
  /// sentence. TM-D3 replaced the key with a claim in the attach grant, so there
  /// is nothing for a person to obtain and nothing to offer them here.
  ///
  /// The remaining unknown is answered where it becomes known rather than
  /// guessed at here: a desktop that grants `read` without `input` is named by
  /// the live attachment in its own words (`TerminalAttachment`, "view only —
  /// this desktop granted read without input").
  static func writeInvitation(sessionSharesWrites: Bool) -> String {
    sessionSharesWrites
      ? "you can type here"
      : "view only — this session is shared read-only"
  }
}
