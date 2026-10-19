/// Pure display vocabulary for the mesh — the godview voice: tiny, heavy,
/// letterspaced, and never overstating (EL5). Pinned by tests.
public enum MeshDisplay {
  /// The chip's word. Uppercase eyebrow style; the count is the only number.
  ///
  /// `linkToken` is the FIELD's own word — `linkLabel(desktops:)` — carried as
  /// the chip's second token where the doors have earned one, on the separator
  /// the mesh's own two halves already use. One marking that reads
  /// "MESH · 2 · DOOR" is one instrument reading; two chips side by side are
  /// two, and the corner has one subject.
  public static func chipLabel(
    state: MeshModel.State, peerCount: Int, linkToken: String? = nil
  ) -> String {
    let mesh = meshToken(state: state, peerCount: peerCount)
    guard let linkToken else { return mesh }
    return "\(mesh) · \(linkToken)"
  }

  private static func meshToken(state: MeshModel.State, peerCount: Int) -> String {
    switch state {
    case .off: "MESH · OFF"
    case .starting: "MESH · …"
    case .needsLogin, .needsMachineAuth: "MESH · SIGN IN"
    case .up: "MESH · \(peerCount)"
    case .stopping, .reconnecting: "MESH · …"
    case .failed: "MESH · FAILED"
    }
  }

  /// The account line (UA-P-1c, D3 interim).
  ///
  /// James's chain is *tailscale login → the account bound to it → that
  /// account's mesh → the services on top*, and the phone drew no part of it:
  /// "signed in" was a truffle PHASE, never a WHO. UA-P-1c drew the one
  /// account-adjacent fact this phone then held — the tailnet domain it
  /// computes so a peer's fully-qualified name can be built
  /// (`MeshModel.magicDNSSuffix`), shown nowhere until then.
  ///
  /// **UA-P-5 makes it the REAL line.** It was the interim one, and said so by
  /// what it named: a tailnet is not a person, `tail1234.ts.net` is the network
  /// this account's login belongs to rather than the login, and the login name
  /// was not on truffle's Apple plane to draw. Petition T4 landed it — RFC 025
  /// §3.6 (D7) puts the login on every public identity surface,
  /// `MeshNode.loginName` included — so the line asserts WHO now. Three
  /// shapes, each saying exactly what is in hand:
  ///
  /// - both — `"alice@corp.com · tail1234.ts.net"`: the person, then the
  ///   network they are on, in the separator the mesh's own instrument
  ///   readings already use;
  /// - the login alone, when there is no domain yet (a dns name with no labels
  ///   to drop) — a person without a network named is still true;
  /// - the domain alone — the UA-P-1c line, word for word, for the window
  ///   before Layer 3 has reported a login. It claims nothing about who, which
  ///   is the honest report of not yet knowing (RFC 022: absent, never
  ///   fabricated).
  ///
  /// `nil` when neither is known. An absent line is a fact not yet in hand; a
  /// line reading "signed in to —" would be the blank design-00 forbids.
  public static func accountLine(login: String? = nil, domain: String?) -> String? {
    let login = (login?.isEmpty ?? true) ? nil : login
    let domain = (domain?.isEmpty ?? true) ? nil : domain
    switch (login, domain) {
    case (let login?, let domain?): return "\(login) · \(domain)"
    case (let login?, nil): return login
    case (nil, let domain?): return "signed in to \(domain)"
    case (nil, nil): return nil
    }
  }

  // MARK: The field's own leg (IOS-4b)

  /// The chip's SECOND token, when the doors have earned one.
  ///
  /// The token speaks for the DOOR and the bodies speak for the FIELD. That is
  /// why the silence is keyed to `.ready` and not to "a board is arriving": a
  /// live board over a dialing door is a field with nothing missing and a door
  /// an attach could not use, since stop, resume and the write grant all ride
  /// the door and only the bytes ride truffle. So "…" over a full field is the
  /// honest warning rather than noise. The token appears only when something
  /// is wrong or pending, which is the same rule the mesh chip itself follows
  /// (EL5 — contrast is how this app says "something needs you").
  ///
  /// **Errata (2026-09-14):** this doc used to justify the silence by the FEED
  /// — "a desktop whose field is arriving needs no word, because the bodies on
  /// the screen already are the word" — while the code has always asked the
  /// door. The code was right and the sentence was wrong, and the case that
  /// tells them apart is the fixture's D1: a board arriving over the store
  /// behind a door at a closed port.
  public static func linkLabel(desktops: [FieldDesktop]) -> String? {
    guard !desktops.isEmpty else { return nil }
    if desktops.contains(where: wantsTheUser) { return "DOOR" }
    if desktops.contains(where: { $0.state == .ready }) { return nil }
    if desktops.contains(where: { $0.state == .connecting || $0.state == .reconnecting }) {
      return "…"
    }
    // Every peer is on the mesh and none is serving a door.
    return "NO DOOR"
  }

  /// The three facts that make the corner speak up, in one place because
  /// `linkLabel`, `chipWantsAttention` and `FieldHomeModel.linkSubject` must
  /// never disagree about which desktop the token is about.
  ///
  /// The third is UA-P-1d's: a door that answered hello and then refused the
  /// FIELD. It used to reach `FieldLink.notes` alone, which no view reads, so
  /// the desktop drew "connected" over an empty field with the reason written
  /// nowhere — the same blank a refused door would have been, wearing a
  /// healthy chip.
  public static func wantsTheUser(_ desktop: FieldDesktop) -> Bool {
    if desktop.fieldRefusal != nil { return true }
    switch desktop.state {
    case .failed, .refusedDoor: return true
    default: return false
    }
  }

  /// The sheet's sentence about one desktop — lowercase facts, the door's
  /// reason verbatim, and the leg its board is arriving on, because "the store
  /// is telling me" and "I am asking the door" are different facts about the
  /// same desktop and only one of them survives the floor's mesh being off.
  public static func linkLine(desktop: FieldDesktop) -> String {
    switch desktop.state {
    case .noDoor:
      return "\(desktop.name) — on the mesh, not serving its product surface"
    case .connecting:
      return "\(desktop.name) — dialing"
    case .reconnecting:
      return "\(desktop.name) — reconnecting"
    case .failed(let reason):
      return "\(desktop.name) — refused: \(reason)"
    case .refusedDoor(let reason):
      // Worth its own sentence, and the sentence CHANGED at UA-P-1a. It used
      // to be "its published door was refused" — a desktop naming a machine it
      // is not. Nothing is published now: the phone builds the address from the
      // peer's own MagicDNS name, so what this state means is that there was
      // nowhere to build one from. Still a thing to look at rather than a thing
      // to retry, and still not the same fact as a door that did not answer.
      return "\(desktop.name) — no door this phone can dial: \(reason)"
    case .ready:
      // UA-P-1d — the field's own refusal, in the door's words. It outranks
      // the feed because it IS the reason there is no feed, and "connected ·
      // no field yet" over a desktop that said no is the honest sentence
      // hiding the honest reason.
      if let refusal = desktop.fieldRefusal {
        return "\(desktop.name) — connected · the field was refused: \(refusal)"
      }
      // RETIRED 2026-10-01 (DS-D14): "connected · field from the mesh", the
      // store leg's sentence — no phone reads `field.agents.v1` any more.
      switch desktop.feed {
      case .door: return "\(desktop.name) — connected · field over the door"
      case .none: return "\(desktop.name) — connected · no field yet"
      }
    }
  }

  /// The chip demands attention only when the mesh needs the user.
  public static func chipWantsAttention(state: MeshModel.State) -> Bool {
    switch state {
    case .needsLogin, .needsMachineAuth: true
    default: false
    }
  }

  /// A refused door wants the user as much as a sign-in does: it is the one
  /// link state a person can act on, and a field that is silently empty
  /// because of it would be the blank the corpus forbids.
  public static func chipWantsAttention(desktops: [FieldDesktop]) -> Bool {
    desktops.contains(where: wantsTheUser)
  }
}
