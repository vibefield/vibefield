import Foundation

/// The TPv3 numbers and names this client speaks, pinned in ONE place.
///
/// Every value here belongs to `packages/contracts/src/registries.ts`
/// (`TERMINAL_PIPELINE`, `TERMINAL_PIPELINE_CLOSE_CODES`) — the contracts law is
/// that ports, limits and codes exist THERE and nowhere else, and the Rust cell
/// reads them by generation (`pnpm gen`). The kit is outside `pnpm verify` and
/// has no generator pointed at it, so each line below is a hand-written copy and
/// a hand-written copy can drift. `scripts/check-ios-fixtures.mjs` pins the ones
/// this client BRANCHES on, value for value, against `registries.ts` — which is
/// why the literals carry the same `_` grouping the TypeScript does: the gate
/// compares the captured text, not a parsed number. The WORDS this client
/// branches on (`LeaseReason`, `InputRefusedReason`, `ExitOutcome`) belong to
/// the contracts' word lists instead, and are pinned the same way.
///
/// Numbers this client does NOT branch on (credit windows, chunk caps, the
/// refresh cadences) are never copied: they arrive at run time in
/// `ConnectionAccepted.protocolLimits`, which is the cell's to own.
public enum RoutedTerminalContract {
  // The protocol version this client offers in every hello. The cell selects
  // the highest mutually supported minor within the major, or refuses
  // `VERSION_UNSUPPORTED` (spec §5.1).
  public static let protocolMajor = 1
  public static let protocolMinor = 0

  // Leg liveness (spec §5.1, door hygiene §8). The CELL owns the receipt
  // deadline and announces it as `heartbeatTtlMs`; these are the client's own
  // defaults for the window before an accept has been read, and the interval
  // the renderer uses. TM-4 does not use the interval literally — it heartbeats
  // at `heartbeatTtlMs / 3` from the ACCEPTED value (see `RoutedLeg`), which at
  // the registry's 15 s TTL is exactly this 5 s.
  public static let heartbeatIntervalMs = 5_000
  public static let heartbeatTtlMs = 15_000

  // Grant validity, applied locally BEFORE a dial so a dead grant costs no
  // socket (the cell applies the same two limits; spec §5.1 "Validity").
  public static let maxClockSkewMs = 5_000
  public static let maxGrantLifetimeMs = 600_000

  /// Input closes this far before an attach grant expires unless a renewal
  /// arrives. The CELL enforces it — it suspends input with `right-expired` and
  /// drops what arrives late, silently by design — so the client's copy only
  /// ever refuses a keystroke on the device instead of sending it to be dropped.
  public static let attachRenewalMarginMs = 60_000

  /// WebSocket close codes on a cell door (`TERMINAL_PIPELINE_CLOSE_CODES`).
  /// `1008` is EVERY pre-authentication failure and is SILENT by policy — no
  /// body, no code on the wire; the reason lives in the cell's audit line, and
  /// this client's rule is the spec's: re-mint once, then UNAVAILABLE.
  public enum CloseCode {
    public static let policyPreAuth = 1008
    public static let serverError = 1011
    public static let staleRoute = 4000
    public static let fenced = 4001
    public static let superseded = 4002
    public static let protocolError = 4003
    public static let legTimeout = 4004
  }

  /// Wire capabilities outside the v1 core profile (TP-D25). A capability is
  /// advertised only when this client can actually honour it:
  ///
  /// - `resume` — TM-4 carries the resume token and sends it on a frames
  ///   re-attach, and handles both outcomes. Advertised.
  /// - `session-events` — LOAD-BEARING in the other direction: the cell stays
  ///   SILENT unless it is negotiated, because an un-negotiated client is
  ///   required to protocol-close on an unknown tag. This client reads
  ///   `SessionEvent` and surfaces it, so it advertises it.
  /// - `geometry-events` (item 42, 2026-10-19) — load-bearing the same way: the
  ///   cell announces a session's geometry seat (`GeometryState`) only to a
  ///   control leg that negotiated it. This client reads the announcement and
  ///   keeps it on the session (`RoutedSessionState.seat`), so it advertises it
  ///   — on both hellos, as `session-events` is; the cell negotiates both on
  ///   the control leg alone.
  /// - `input-refusals` — load-bearing the same way (audit C5): the
  ///   cell answers a `SendInput` it turned away with `InputRefused` only when
  ///   asked. This client reads it and the card says the input went nowhere,
  ///   so it advertises it.
  /// - `snapshot-demand` — NOT advertised: the phone's demand is `none` or
  ///   `live`, the core profile's own pair.
  /// - `profiling-envelope` — NOT advertised: nothing on the phone consumes the
  ///   timestamps yet, and asking for bytes nobody reads is a cost, not a hedge.
  public static let capabilities = ["resume", "session-events", "geometry-events", "input-refusals"]

  public static let resumeCapability = "resume"
  public static let sessionEventsCapability = "session-events"
  public static let geometryEventsCapability = "geometry-events"
  public static let inputRefusalsCapability = "input-refusals"

  /// The lease's and the exit's WORDS this client branches on (audit C5, C8;
  /// the fixer's review, finding 8). Their lists are the contracts':
  /// `PRESENTATION_STOPPED_REASONS`, `ACTIVATION_REVOKED_REASONS` and
  /// `INPUT_REFUSED_REASONS` in `terminal-pipeline.ts`, `TerminalExitOutcome` in
  /// `terminal.ts`. `scripts/check-ios-fixtures.mjs` pins each word here to its
  /// list, so a word renamed on one side is red, never a branch that quietly
  /// stops matching.
  public enum LeaseReason {
    /// `stopped{exited}` / `revoked{exited}` — the session's run exited (C8).
    public static let exited = "exited"
  }

  /// `InputRefused.reason` — the lease's own input word, or the fence that
  /// refused (C5).
  public enum InputRefusedReason {
    public static let lagging = "lagging"
    public static let overload = "overload"
    public static let rightExpired = "right-expired"
    public static let pending = "pending"
    public static let notGranted = "not-granted"
    public static let rightRevoked = "right-revoked"
    public static let exited = "exited"
    public static let staleLeaseEpoch = "stale-lease-epoch"
    public static let noView = "no-view"
  }

  /// `SessionEvent.exitOutcome` — who ended a run the cell named as requested
  /// (C8).
  public enum ExitOutcome {
    public static let userTerminated = "user-terminated"
    public static let applicationTerminated = "application-terminated"
    public static let serviceTerminated = "service-terminated"
  }
}

/// What THIS phone can hold on the frames leg (`ConnectionHello.receiverCapacities`).
///
/// Receive capacity belongs to the RECEIVER (spec §5.1): the cell accepts the
/// minimum of these and its own caps, so understating is safe and overstating is
/// a promise this process has to keep in memory. The browser worker's advertised
/// numbers are a desktop's (8 MiB connection / 2 MiB per activation, 16 MiB
/// staging per session — `tp-connection-hello.frames.json`); a phone is not a
/// desktop, so these are ITS numbers and the reasoning is written down rather
/// than inherited:
///
/// - `connectionCreditBytes` 2 MiB — the bytes this client lets the cell put on
///   the wire before it must wait for a return. A terminal delta is a few KiB
///   and the seed is the big one; 2 MiB covers a seed plus a burst with room,
///   and it is the ceiling on how much of somebody else's data a stalled phone
///   can be holding.
/// - `perActivationCreditBytes` 512 KiB — the fairness floor. One stalled
///   session may exhaust only its own account (§8 law 7), so this is what a
///   single misbehaving session can cost the others: a quarter of the
///   connection, never the whole of it.
/// - `stagingBytesPerSession` 4 MiB / `stagingBytesTotal` 16 MiB — a seed is
///   staged whole before it is applied, so this is the real memory promise. A
///   cell's seed is bounded by ITS `maxCatchupBytes`; 4 MiB is above any
///   plausible viewport-plus-scrollback frame for a phone and 16 MiB bounds the
///   whole app's staging even with four sessions seeding at once.
/// - `maxConcurrentActivations` 8 — a phone shows one terminal and may hold a
///   few warm. 8 is generous; 256 (the cell's cap) would be a lie about what
///   this device would do with them.
/// - `maxConcurrentSeeds` 2 — the one the user is looking at, plus one arriving.
///
/// Every number is a MEMORY promise this process keeps. They are the phone's to
/// change when a measurement says so (TM-5's device run is the first one that
/// can); nothing here is derived from the desktop's.
public struct RoutedReceiverCapacities: Sendable, Equatable {
  public var connectionCreditBytes: Int
  public var perActivationCreditBytes: Int
  public var stagingBytesPerSession: Int
  public var stagingBytesTotal: Int
  public var maxConcurrentActivations: Int
  public var maxConcurrentSeeds: Int

  public init(
    connectionCreditBytes: Int,
    perActivationCreditBytes: Int,
    stagingBytesPerSession: Int,
    stagingBytesTotal: Int,
    maxConcurrentActivations: Int,
    maxConcurrentSeeds: Int
  ) {
    self.connectionCreditBytes = connectionCreditBytes
    self.perActivationCreditBytes = perActivationCreditBytes
    self.stagingBytesPerSession = stagingBytesPerSession
    self.stagingBytesTotal = stagingBytesTotal
    self.maxConcurrentActivations = maxConcurrentActivations
    self.maxConcurrentSeeds = maxConcurrentSeeds
  }

  /// The phone's advertised window (the reasoning is on the type).
  public static let phone = RoutedReceiverCapacities(
    connectionCreditBytes: 2 * 1024 * 1024,
    perActivationCreditBytes: 512 * 1024,
    stagingBytesPerSession: 4 * 1024 * 1024,
    stagingBytesTotal: 16 * 1024 * 1024,
    maxConcurrentActivations: 8,
    maxConcurrentSeeds: 2)
}

/// Cell-owned limits, read off `ConnectionAccepted`. Tolerant: a cell that omits
/// one is not a protocol error — the client keeps its own floor for the few it
/// uses and ignores the rest (it consumes none of the writer-side numbers,
/// which describe the CELL's admission).
public struct RoutedProtocolLimits: Sendable, Equatable {
  public var maxControlMessageBytes: Int
  public var maxPresentationChunkBytes: Int
  public var maxCreditReturnDelayMs: Int
  public var sceneAppliedRefreshMs: Int
  public var activationAttachDeadlineMs: Int
  public var maxCatchupBytes: Int
  public var creditAccountDrainTtlMs: Int

  /// The floors used when a cell says nothing. Deliberately CONSERVATIVE rather
  /// than the registry's defaults: a client that guesses a large cap and is
  /// wrong drops frames, where one that guesses small only returns credit more
  /// often than it had to.
  public static let floor = RoutedProtocolLimits(
    maxControlMessageBytes: 64 * 1024,
    maxPresentationChunkBytes: 256 * 1024,
    maxCreditReturnDelayMs: 16,
    sceneAppliedRefreshMs: 1_000,
    activationAttachDeadlineMs: 5_000,
    maxCatchupBytes: 8 * 1024 * 1024,
    creditAccountDrainTtlMs: 5_000)
}
