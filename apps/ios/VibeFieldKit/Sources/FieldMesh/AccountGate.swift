import Foundation

/// UA-P-5 — the account gate: this phone's node admits only its own login.
///
/// James's ruling of 2026-09-15 (UA-P-D2): *"the VibeField ecosystem linked
/// with this account interacts only with the nodes under this user's tailscale
/// account."* truffle answers it as RFC 025: a node started with a non-empty
/// `loginAllow` reports only peers whose Layer 3 login matches, and refuses
/// every inbound hello whose WhoIs login does not — with close code 4004,
/// before our own hello is revealed. The gate is PER NODE and fixed for the
/// node's lifetime (RFC 025 §3.1, D1), so changing it means restarting.
///
/// This type is the phone's half of that: which list a node starts with, and
/// what the node's own login asks of the list it started with. Every decision
/// here is pure and every one of them is a row in
/// `AccountGateTests` — the restart is the expensive event and a state machine
/// that only reveals itself on a live tailnet is one nobody can check.
public enum AccountGate {
  /// The list a node starts with, from the login this app remembers.
  ///
  /// Empty is not a default — it is the PRE-LOGIN window, and it is why the
  /// store bus stays off until the list is non-empty: an ungated node is on
  /// the whole tailnet, which is exactly the audience the ruling forbids
  /// anything content-bearing from reaching.
  public static func allowList(for remembered: String?) -> [String] {
    guard let remembered, !remembered.isEmpty else { return [] }
    return [glob(for: remembered)]
  }

  /// One LOGIN as one GLOB.
  ///
  /// The gate's grammar is Go's `path.Match` (RFC 025 §3.2), so `*`, `?`, `[`
  /// and `\` are syntax there and a login carrying one would be a wildcard
  /// rather than a name. A tailscale login is an email address or a
  /// `user@github`-style handle and will not contain them in practice — which
  /// is the whole reason to escape them anyway: the day one does is the day a
  /// gate silently admits a class of strangers, and the cost of being right
  /// about it is four characters.
  ///
  /// `\` goes first: escaping it after the others would escape the escapes.
  public static func glob(for login: String) -> String {
    var out = ""
    out.reserveCapacity(login.count)
    for character in login {
      if character == "\\" || character == "*" || character == "?" || character == "[" {
        out.append("\\")
      }
      out.append(character)
    }
    return out
  }

  /// Does this allow-list name exactly this one login, and nothing else?
  ///
  /// Asked of the NODE's own list rather than of our memory of it (see
  /// `FieldTruffleRuntime.isGatedOnAccount`), because the list the node is
  /// actually running is the thing that gates and a copy of it is only a
  /// claim. Case-insensitively, because the gate matches that way.
  public static func gates(_ allow: [String], login: String) -> Bool {
    allow.count == 1 && allow[0].lowercased() == glob(for: login).lowercased()
  }

  /// Two logins, compared the way the gate compares them (RFC 025 §3.2:
  /// lowercased on both sides). `nil` on either side is never a match —
  /// absent is not equal to anything, including another absent.
  public static func sameLogin(_ a: String?, _ b: String?) -> Bool {
    guard let a, let b, !a.isEmpty, !b.isEmpty else { return false }
    return a.lowercased() == b.lowercased()
  }

  /// What the node's current login asks of the gate it started with.
  ///
  /// The whole state machine, in one function:
  ///
  /// | gated on | node reports | step          |
  /// |----------|--------------|---------------|
  /// | nothing  | nothing      | `.nothing` — the pre-login window; wait |
  /// | nothing  | a login      | `.remember` — record it, restart gated  |
  /// | a login  | nothing      | `.nothing` — see below                  |
  /// | a login  | the same one | `.nothing` — settled                    |
  /// | a login  | another one  | `.regate` — record it, restart gated    |
  ///
  /// **An absent login is never a switch.** The login is a Layer 3 fact and
  /// the Apple plane reads it through a status overlay that can fail (RFC 024
  /// §8.1.2), so `nil` means "this node cannot currently state who it is",
  /// never "nobody". Treating that as a change would tear the node down and
  /// rebuild it every time a status refresh came back thin — and RFC 022's
  /// absent-never-fabricated rule says the honest reading of an absent fact is
  /// silence.
  public static func step(gatedOn gate: String?, reports login: String?) -> AccountStep {
    guard let login, !login.isEmpty else { return .nothing }
    guard let gate, !gate.isEmpty else { return .remember(login) }
    return sameLogin(gate, login) ? .nothing : .regate(login)
  }
}

/// What the gate asks the app to do next. One restart per fresh sign-in, and
/// one per account switch; `.nothing` the rest of the time.
public enum AccountStep: Equatable, Sendable {
  case nothing
  /// The pre-login window closed: this node learned its login and has none
  /// remembered. Record it and restart gated on it.
  case remember(String)
  /// This device is signed into a DIFFERENT tailscale account than the one
  /// the gate names. Record the new login and restart gated on it.
  ///
  /// **It clears nothing.** What a phone forgets when the account changes —
  /// the ledger, the slices, the faces, and what of it is the person's rather
  /// than the field's — is UA-P-D4, and D4 is open and James's
  /// (`draft/thinking-ua-phone-account.md` §6). This lane deliberately builds
  /// no sign-out, no switch act and no clearing rule: re-gating is what keeps
  /// the mesh honest about WHO, and forgetting is a separate decision that
  /// has not been made.
  case regate(String)

  /// The login a step names, if it names one.
  public var login: String? {
    switch self {
    case .nothing: nil
    case .remember(let login), .regate(let login): login
    }
  }
}

/// The remembered login, as one file beside truffle's own state.
///
/// It sits IN the node's state directory (`account.login` next to
/// `device-id.txt` and the Tailscale keys) for two reasons: the gate is a fact
/// about that node and travels with it — `FieldTruffleRuntime`'s one-time
/// directory rename carries it across for free — and a login is not a secret.
/// It is the name the tailnet already publishes for every peer this phone can
/// see; what it protects is not confidentiality but the ability to start
/// gated on the FIRST launch after a sign-in, with no round trip and no window
/// in which the node is on the whole tailnet.
public struct AccountLoginStore: Sendable {
  public static let fileName = "account.login"

  public let url: URL

  public init(stateDirectory: URL) {
    url = stateDirectory.appendingPathComponent(Self.fileName, isDirectory: false)
  }

  /// The remembered login, or nil when there is none to remember.
  ///
  /// Trimmed, because a trailing newline from any hand that ever edits this
  /// file would make the gate a glob that matches nothing — fail-closed, and
  /// therefore a phone with an empty mesh and no reason on screen. Empty
  /// reads as absent.
  public func read() -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    let text = String(decoding: data, as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  /// Record a login. Written BEFORE the restart it asks for, so a launch that
  /// dies in between comes back gated rather than repeating the window.
  public func write(_ login: String) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(login.utf8).write(to: url, options: .atomic)
  }

  // Deliberately no `clear()`. Forgetting an account is UA-P-D4 and D4 is
  // open — see `AccountStep.regate`.
}
