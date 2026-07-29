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

  /// The chip demands attention only when the mesh needs the user.
  public static func chipWantsAttention(state: MeshModel.State) -> Bool {
    switch state {
    case .needsLogin, .needsMachineAuth: true
    default: false
    }
  }
}
