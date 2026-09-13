/// Pure display vocabulary for the mesh — the godview voice: tiny, heavy,
/// letterspaced, and never overstating (EL5). Pinned by tests.
public enum MeshDisplay {
  /// The chip's word. Uppercase eyebrow style; the count is the only number.
  public static func chipLabel(state: MeshModel.State, peerCount: Int) -> String {
    switch state {
    case .off: "MESH · OFF"
    case .starting: "MESH · …"
    case .needsLogin, .needsMachineAuth: "MESH · SIGN IN"
    case .up: "MESH · \(peerCount)"
    case .stopping: "MESH · …"
    case .failed: "MESH · FAILED"
    }
  }

  /// The sheet's status sentence — lowercase facts, reasons verbatim.
  public static func statusLine(state: MeshModel.State, peerCount: Int) -> String {
    switch state {
    case .off: "not connected — the mesh starts only when you ask"
    case .starting: "starting the tailscale runtime"
    case .needsLogin: "sign in to your tailnet to come online"
    case .needsMachineAuth: "this device awaits machine authorization"
    case .up:
      peerCount == 1 ? "online · 1 peer in reach" : "online · \(peerCount) peers in reach"
    case .stopping: "leaving the mesh"
    case .failed(let reason): "failed — \(reason)"
    }
  }

  /// The primary act available in each state (nil = no action, just wait).
  public enum Action: String, Equatable {
    case connect = "CONNECT"
    case signIn = "SIGN IN"
    case disconnect = "DISCONNECT"
  }

  public static func primaryAction(state: MeshModel.State) -> Action? {
    switch state {
    case .off, .failed: .connect
    case .needsLogin: .signIn
    case .up, .needsMachineAuth: .disconnect
    case .starting, .stopping: nil
    }
  }

  // MARK: The field's own leg (IOS-4b)

  /// The chip's SECOND token, when the doors have earned one.
  ///
  /// Silence is the healthy answer: a desktop whose field is arriving needs no
  /// word, because the bodies on the screen already are the word. The token
  /// appears only when something is wrong or pending, which is the same rule
  /// the mesh chip itself follows (EL5 — contrast is how this app says
  /// "something needs you").
  public static func linkLabel(desktops: [FieldDesktop]) -> String? {
    guard !desktops.isEmpty else { return nil }
    if desktops.contains(where: { if case .failed = $0.state { true } else { false } }) {
      return "DOOR"
    }
    if desktops.contains(where: { $0.state == .ready }) { return nil }
    if desktops.contains(where: { $0.state == .connecting || $0.state == .reconnecting }) {
      return "…"
    }
    // Every desktop published a slice and none is serving a door.
    return "NO DOOR"
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
    case .ready:
      switch desktop.feed {
      case .store: return "\(desktop.name) — connected · field from the mesh"
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
    desktops.contains { if case .failed = $0.state { true } else { false } }
  }
}
