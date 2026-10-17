import Foundation

/// The freeway numbers and names this client speaks, pinned in ONE place.
///
/// Every value here belongs to `packages/contracts/src/registries.ts` (`FREEWAY`, `FREEWAY_FRAME`,
/// `FREEWAY_FRAGMENT_BIT`, `FREEWAY_CODES`, `PORTS.FREEWAY_SERVE`) — the contracts law is that ports,
/// limits and codes exist THERE and nowhere else, and the freeway host reads them by generation
/// (`pnpm gen`). The kit has no generator pointed at it, so each line below is a hand-written copy,
/// and `scripts/check-ios-fixtures.mjs` pins every one, value for value, against its own block of
/// `registries.ts`. The literals carry the TypeScript's own spelling (its `_` grouping, its `*`)
/// because the gate compares the captured text, not a parsed number.
///
/// Numbers the host ANNOUNCES are never copied: the welcome carries the link's `limits` (fragment
/// bytes, stream window, stream cap) and its `heartbeatMs`, which are the host's to own.
public enum FreewayContract {
  /// The tailnet listener the freeway host is served on.
  public static let servePort = 9425

  // The major this client offers in its hello; a host that speaks another closes the link
  // `protocolVersion` (4426).
  public static let protocolMajor = 1
  // Pings unanswered before the link is dead (the cadence is the welcome's `heartbeatMs`).
  public static let missedPings = 3
  // A receiver acks every this many bytes it has taken off the link (`Ack {bytes}`, stream 0).
  public static let ackEveryBytes = 65_536
  // An approval's life, and the point the phone asks for the next one.
  public static let approvalTtlMs = 30 * 60_000
  public static let approvalRenewMs = 20 * 60_000
  // Session ids in one `terminal-tickets` ask, at most.
  public static let maxTicketsPerAsk = 64

  /// The frame types: the low seven bits of a frame's first byte.
  public enum FrameByte {
    public static let link: UInt8 = 0x00
    public static let open: UInt8 = 0x01
    public static let opened: UInt8 = 0x02
    public static let text: UInt8 = 0x03
    public static let binary: UInt8 = 0x04
    public static let close: UInt8 = 0x05
    public static let window: UInt8 = 0x06
    public static let openRefused: UInt8 = 0x07
  }

  /// Set on a TEXT or BINARY frame type: more fragments of this message follow.
  public static let fragmentBit: UInt8 = 0x80

  /// The link's own codes: a WebSocket close of the whole link, or the `code` of an `OPEN_REFUSED`.
  /// A stream's CLOSE never uses these — it carries its leg's own close code verbatim.
  public enum Code {
    public static let protocolError = 4400
    public static let approval = 4401
    public static let notAdmitted = 4403
    public static let kindNotServed = 4404
    public static let superseded = 4409
    public static let peerGone = 4410
    public static let twin = 4411
    public static let protocolVersion = 4426
    public static let restarting = 4503
    public static let doorDown = 4504
  }
}
