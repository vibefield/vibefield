import Foundation

// UA-P-1a — discovery by the door.
//
// James's ruling of 2026-09-15 (UA-P-D2): a store is scoped to the login
// identity, and until truffle can gate by login NOTHING CONTENT-BEARING RIDES
// THE BUS. `field.devices.v1` stops being published, so the phone stops
// learning desktops from it. What it has instead is truffle's peer list — every
// node whose Tailscale hostname carries the `truffle-vibefield-` prefix — and
// one question to ask each of them: is this desktop mine?
//
// The desktop answers that question at the door, and it answers it TWICE over,
// which is the property this file exists to keep straight:
//
//   1. the sidecar's serve allow-list compares the caller's WhoIs login to the
//      stored link and refuses a stranger with a 403 before fieldd sees the
//      socket (`packages/fieldd/src/daemon.ts`, `productServeSpec`);
//   2. fieldd's own stored-login comparison mints a zero-scope `tailnet-guest`
//      for a foreign login that got past the first (`product-api.ts`), so a
//      hello can succeed and grant NOTHING.
//
// The phone treats both as the same verdict — not this account's desktop — and
// draws neither. The second is being removed on the desktop side under the same
// ruling; the phone keeps reading it anyway, because a face that depends on the
// other plane having shipped is a face that lies on the day it has not.

/// What one plain request to a door came back as.
///
/// A STATUS is an answer: something on the tailnet is listening at that address
/// and it said something. `unreachable` is the absence of one, and the two must
/// never collapse — "that desktop is not mine" and "that desktop is asleep" are
/// different sentences, and only the first should stop the phone re-asking soon.
public enum DoorProbeOutcome: Sendable, Equatable {
  case status(Int)
  /// The transport's own words, for the log.
  case unreachable(String)
}

/// The verdict on one peer, from whichever half of the door answered.
public enum DoorAdmission: Sendable, Equatable {
  /// There is a door here and it did not refuse this phone. Dial it.
  case answering
  /// This peer is a VibeField node, and not one this account's login may open.
  /// Never drawn as a failure — it is somebody else's desktop, which is an
  /// ordinary thing for a tailnet to contain.
  case notThisAccount(String)
  /// Nothing answered. A desktop that is asleep, off the tailnet, or not
  /// serving its product surface — the state the corner has always called
  /// "on the mesh, not serving its product surface".
  case unreachable(String)
}

/// The rules, pure and pinned by tests — no clock, no socket, no peer.
public enum DoorPolicy {
  /// The statuses that mean "the allow-list does not name this phone's login".
  ///
  /// 403 is the sidecar's own answer and the one the ruling is about. 401 is
  /// admitted to the same verdict because a door that asks this phone for a
  /// credential is a door this phone cannot open: it presents none by design
  /// (C5 — WhoIs is the grant, and a token on the tailnet door would be wrong
  /// rather than merely absent), so re-asking in thirty seconds would be
  /// asking the same question with the same empty hands.
  public static let refusedStatuses: Set<Int> = [401, 403]

  /// A probe's answer, judged.
  ///
  /// Every other status is `answering`, INCLUDING the 4xx and 5xx a WebSocket
  /// endpoint gives a plain GET — 400 and 426 are what fieldd's control port
  /// says to a request that is not an upgrade, and reading either as a refusal
  /// would turn the phone's own probe into the reason it never dials. The only
  /// thing this rule is allowed to be sure about is the two it names.
  public static func admission(for outcome: DoorProbeOutcome) -> DoorAdmission {
    switch outcome {
    case .status(let code):
      if refusedStatuses.contains(code) {
        return .notThisAccount("the door refused this login (\(code))")
      }
      return .answering
    case .unreachable(let reason):
      return .unreachable(reason)
    }
  }

  /// The hello's own answer, judged.
  ///
  /// An EMPTY grant on a successful hello is fieldd's `tailnet-guest`: the
  /// door compared this caller's WhoIs login to its stored link, found a
  /// stranger, and answered with a principal that may ask for `system.hello`
  /// and nothing else. Drawing that desktop would put another person's machine
  /// in this phone's corner with every act on it dead, which is the face
  /// UA-P-1a exists to remove.
  public static func admission(forGrantedScopes scopes: [String]) -> DoorAdmission {
    scopes.isEmpty
      ? .notThisAccount("the door granted nothing — this is another account's desktop")
      : .answering
  }
}

/// One plain request to a door, for its status.
///
/// A protocol because the rules above are about STATUSES, and proving them
/// should not want a tailnet: the rehearsals hand `FieldLink` a scripted probe
/// the same way they hand it a scripted door.
public protocol ProductDoorProbe: Sendable {
  func probe(_ url: URL) async -> DoorProbeOutcome
}

/// The real one.
///
/// The SESSION is injected for the same reason the product transport's is, and
/// it is the difference between reaching a desktop and not: this phone's
/// tailnet is a userspace netstack in this process, so a plain `URLSession`
/// sends a `100.x` address nowhere and resolves a MagicDNS name, if at all, on
/// the device's ordinary network.
///
/// `GET` rather than `HEAD`: the sidecar's refusal and fieldd's own answers are
/// both tiny, and a HEAD is the request a proxy is most likely to answer
/// differently from the one that follows it. What is wanted here is the answer
/// the REAL dial would get.
public struct URLSessionDoorProbe: ProductDoorProbe {
  public typealias SessionProvider = @Sendable (URLSessionConfiguration) async throws -> URLSession

  private let configuration: URLSessionConfiguration
  private let provider: SessionProvider

  /// Short by design. This runs once per peer per discovery pass, on a radio,
  /// and a desktop that has not answered in eight seconds is one the phone
  /// should call unreachable and re-ask later rather than hold a slot for.
  public init(timeout: TimeInterval = 8, session: SessionProvider? = nil) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.waitsForConnectivity = false
    configuration.httpShouldSetCookies = false
    self.configuration = configuration
    self.provider = session ?? { URLSession(configuration: $0) }
  }

  public func probe(_ url: URL) async -> DoorProbeOutcome {
    do {
      let session = try await provider(configuration)
      defer { session.finishTasksAndInvalidate() }
      var request = URLRequest(url: url)
      request.httpMethod = "GET"
      // Nothing about this phone rides the probe. It carries no credential by
      // design, and it must not carry a fingerprint either: what the door is
      // being asked is "would you admit my login", and the login is WhoIs's to
      // answer from the connection, not this request's to assert.
      request.setValue("close", forHTTPHeaderField: "Connection")
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        return .unreachable("the door answered something that is not HTTP")
      }
      return .status(http.statusCode)
    } catch {
      return .unreachable(MeshModel.shortReason(error))
    }
  }
}
