import FieldProduct
import Foundation
import RosettaClient

// SP-7b's 7b-2b — ONE SESSION READ DIRECTLY (`SP-7b-2-delta.md` §2): a ticket asked at the home, rosetta's own client
// over the phone's own network with the ticket's grant, and the Swift projection, so `HistoryDesktopReader` holds the
// same rows the door would have sent. No transcript byte rides fieldd's RPC (EL2); the header, the lists and search
// stay on the door, which a grant does not open.
//
// rosetta's client keeps the subscription's law (snapshot, mutations keyed by `timeline_id`, resync, resume), and this
// file adds only what the phone needs around it:
// - the grant's life: a fresh ticket before `INDEX_TICKET.TTL_MS`, handed over with `setCredential`, so a reconnect
//   always has a grant in date. An open socket is left alone: rosetta checks a credential at the upgrade;
// - a 401 `expired` on a page renews once, and reads again;
// - the four roads back to the door's pages (`HistoryDirectFallback`): no ticket, no pages, a refusal, a socket that
//   does not answer. The reader says which, and reads as it always has.
// - (item 362g) a recorded picture's rendition, read by the same client under the same grant and the same renew-once
//   rule (`picture(_:size:)`). Its bytes ride this ticketed road and never fieldd's RPC (EL2), and a picture that is
//   not read ends nothing.
//
// An older page is fetched and then REVEALED under the subscription, so it takes later patches and `onChange` hands
// the whole visible list; a row is projected once, and again only when its entry changed (`HistoryProjectionCache`).
// A generation replaced (a resync, a rewrite) replaces the rows and the cursor together, so item 109's hole cannot
// form here: a reader holds what the subscription shows and nothing below it.

/// Why a session is read through the door. Its words are the reader's record: the UI is unchanged (SP-7b plan, 7b-2).
public enum HistoryDirectFallback: Equatable, Sendable {
  /// The ask failed, or the answer was not a ticket: the door's own refusals, in another shape than these.
  case noTicket
  /// A ticket with no usable `restUrl`: an older owner's, or one nothing could dial.
  case noPages
  case refused(IndexTicketRefusal)
  /// The socket did not answer in time, or the pages stopped.
  case socket

  /// What the reader says, for the record.
  public var said: String {
    switch self {
    case .noTicket:
      return "read through the door: this desktop gave no ticket"
    case .noPages:
      return "read through the door: this desktop's ticket names no pages"
    case .socket:
      return "read through the door: the direct read did not answer"
    case .refused(.directPlaneUnbuilt):
      return "read through the door: this desktop does not serve the direct read yet"
    case .refused(.directPlaneOff):
      return "read through the door: the direct read is switched off on this desktop"
    case .refused(.egressUnavailable(let device)):
      return "read through the door: no road to \(device)"
    case .refused(.doorsNotPublished(let device)):
      return "read through the door: \(device) has no direct read to hand out"
    }
  }

  /// Nothing a retry changes for this desktop's daemon: the reader stops asking it.
  var endsThePlane: Bool {
    self == .refused(.directPlaneUnbuilt) || self == .refused(.directPlaneOff)
  }
}

/// What the composition hands a desktop's reader to read its sessions directly. FieldHistory stays free of the mesh
/// (D-E1's note): the ticket's ask and the network arrive as closures.
public struct HistoryDirectPlane {
  public typealias SessionProvider = @Sendable (URLSessionConfiguration) async throws -> URLSession

  /// `index.openTicket` for a session of this desktop, asked at the home; the answer unread.
  let ticket: @MainActor (String) async throws -> FieldProduct.JSONValue
  /// The phone's network: nil while the mesh is not up.
  let session: @MainActor () async -> SessionProvider?
  /// The tests' scripted socket; nil is the client's own, over the session above.
  let sockets: (any RosettaSocketFactory)?
  let renewEvery: Duration
  let openDeadline: Duration

  public init(
    ticket: @escaping @MainActor (String) async throws -> FieldProduct.JSONValue,
    session: @escaping @MainActor () async -> SessionProvider?
  ) {
    self.init(
      ticket: ticket, session: session, sockets: nil, renewEvery: .milliseconds(HistoryReads.directRenewMs),
      openDeadline: .seconds(HistoryReads.directOpenSeconds))
  }

  init(
    ticket: @escaping @MainActor (String) async throws -> FieldProduct.JSONValue,
    session: @escaping @MainActor () async -> SessionProvider?,
    sockets: (any RosettaSocketFactory)?, renewEvery: Duration, openDeadline: Duration
  ) {
    self.ticket = ticket
    self.session = session
    self.sockets = sockets
    self.renewEvery = renewEvery
    self.openDeadline = openDeadline
  }
}

/// One session's direct read, from its ticket to its close. The owner holds it while it opens and while it is live.
@MainActor
final class HistoryDirectRead {
  enum Outcome: Equatable, Sendable {
    /// The first snapshot landed.
    case live
    /// The door reads this session.
    case door(HistoryDirectFallback)
    /// The owner closed it first.
    case closed
  }

  /// How the read speaks to its owner.
  struct Sink {
    /// A page's continuation and its generation: the snapshot's, or an older page's before it is revealed.
    let page: @MainActor (_ cursor: String?, _ watermark: String) -> Void
    /// Every visible row, in order, after a change; and, by row id, what their entries carry beyond them (362f).
    let rows: @MainActor ([IndexTimelineRow], [String: HistoryLineDetail]) -> Void
    /// The read gave up after it was live; it is already closed.
    let lost: @MainActor (HistoryDirectFallback) -> Void
  }

  /// A failed renewal asks again this soon: the grant it holds is near its end.
  private static let renewRetry = Duration.seconds(30)

  private let sessionId: String
  private let plane: HistoryDirectPlane
  private let sink: Sink
  private let log: @MainActor (String) -> Void
  private var client: RosettaClient?
  private var urlSession: URLSession?
  private var subscription: SessionSubscription?
  private var cache = HistoryProjectionCache<TimelineEntry, HistoryProjected>()
  private var opening: CheckedContinuation<Outcome, Never>?
  private var deadline: Task<Void, Never>?
  private var renewal: Task<Void, Never>?
  private var closed = false

  init(
    sessionId: String, plane: HistoryDirectPlane, sink: Sink, log: @escaping @MainActor (String) -> Void
  ) {
    self.sessionId = sessionId
    self.plane = plane
    self.sink = sink
    self.log = log
  }

  // MARK: Opening

  /// The ticket, the network, the subscription: answers at the first snapshot or the first road back.
  func open() async -> Outcome {
    let answer: FieldProduct.JSONValue
    do {
      answer = try await plane.ticket(sessionId)
    } catch {
      return closed ? .closed : .door(Self.fallback(for: error))
    }
    guard !closed else { return .closed }
    guard let ticket = try? IndexOpenTicket(json: answer) else { return .door(.noTicket) }
    guard let base = ticket.restUrl else { return .door(.noPages) }
    guard let provider = await plane.session() else { return closed ? .closed : .door(.socket) }
    guard let session = try? await Self.makeSession(provider) else {
      return closed ? .closed : .door(.socket)
    }
    guard !closed else {
      session.invalidateAndCancel()
      return .closed
    }
    urlSession = session
    let client = RosettaClient(
      baseURL: base, session: session, credential: .grant(ticket.grant), sockets: plane.sockets)
    self.client = client
    let outcome = await withCheckedContinuation { (continuation: CheckedContinuation<Outcome, Never>) in
      opening = continuation
      subscription = client.subscribeSession(sessionId, handlers: handlers())
    }
    if outcome == .live { startRenewal() }
    return outcome
  }

  private static func fallback(for error: any Error) -> HistoryDirectFallback {
    guard let refusal = error as? FieldProductError, let ticket = IndexTicketRefusal(error: refusal) else {
      return .noTicket
    }
    return .refused(ticket)
  }

  /// Off the main actor, so the fresh configuration crosses no isolation on its way to the provider.
  ///
  /// Item 362g — the configuration is handed over with NO cache, and its requests pass any cache by. rosettad's
  /// answers are immutable, so a session with a cache would keep pictures of its own, outside the count of the
  /// one memory pictures are kept in, which has a byte bound (`HistoryPictureStore`). It covers the pages and the
  /// socket too, which is right: nothing the direct read fetches should be answered from a cache.
  nonisolated private static func makeSession(
    _ provider: HistoryDirectPlane.SessionProvider
  ) async throws -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    return try await provider(configuration)
  }

  private func handlers() -> SessionSubscriptionHandlers {
    SessionSubscriptionHandlers(
      onSnapshot: { [weak self] page in self?.snapshot(page) },
      onChange: { [weak self] entries in self?.changed(entries) },
      onStatus: { [weak self] status in self?.heard(status) },
      onError: { [weak self] error in self?.log("history direct read: \(error.code.rawValue)") })
  }

  // MARK: The subscription

  private func snapshot(_ page: TimelinePage) {
    sink.page(page.cursor, page.watermark)
    guard let pending = opening else { return }
    opening = nil
    pending.resume(returning: .live)
  }

  private func changed(_ entries: [TimelineEntry]) {
    let projected = cache.rows(
      of: entries, id: { $0.timelineId }, project: { HistoryProjection.projected(entry: $0) })
    var details: [String: HistoryLineDetail] = [:]
    for item in projected {
      if let detail = item.detail { details[item.row.timelineId] = detail }
    }
    sink.rows(projected.map(\.row), details)
  }

  private func heard(_ status: SubscriptionStatus) {
    switch status {
    case .connecting:
      armDeadline()
    case .syncing, .resyncing, .live:
      // the socket answered: rosetta's own sync deadline bounds what is left of it
      clearDeadline()
    case .closed:
      giveUp(.socket)
    }
  }

  private func armDeadline() {
    guard deadline == nil else { return }
    let wait = plane.openDeadline
    deadline = Task { [weak self] in
      try? await Task.sleep(for: wait)
      guard !Task.isCancelled else { return }
      self?.giveUp(.socket)
    }
  }

  private func clearDeadline() {
    deadline?.cancel()
    deadline = nil
  }

  // MARK: The grant's life

  private func startRenewal() {
    let every = plane.renewEvery
    renewal = Task { [weak self] in
      var wait = every
      while !Task.isCancelled {
        try? await Task.sleep(for: wait)
        guard !Task.isCancelled, let self else { return }
        let renewed = await self.renew()
        wait = renewed ? every : min(every, Self.renewRetry)
      }
    }
  }

  /// A fresh ticket's grant, for every later request and reconnect. An open socket is left alone.
  private func renew() async -> Bool {
    guard let client, !closed else { return false }
    do {
      let answer = try await plane.ticket(sessionId)
      let ticket = try IndexOpenTicket(json: answer)
      guard !closed else { return false }
      client.setCredential(.grant(ticket.grant))
      return true
    } catch {
      log("history direct read: the grant was not renewed")
      return false
    }
  }

  // MARK: Older pages

  /// The page before `cursor`, under the subscription. An expired grant renews once and reads again. True when the
  /// page was revealed; false when it was not, and what follows is the subscription's or the owner's (`failed`).
  func older(cursor: String) async -> Bool {
    guard let subscription, !closed else { return false }
    do {
      try await fetchAndReveal(cursor, subscription)
      return true
    } catch {
      guard Self.isExpired(error), await renew() else {
        failed(error)
        return false
      }
      do {
        try await fetchAndReveal(cursor, subscription)
        return true
      } catch {
        failed(error)
        return false
      }
    }
  }

  private func fetchAndReveal(_ cursor: String, _ subscription: SessionSubscription) async throws {
    let page = try await subscription.fetchPage(cursor: cursor, limit: HistoryReads.pageRows)
    sink.page(page.cursor, page.watermark)
    subscription.reveal(page.entries)
  }

  private static func isExpired(_ error: any Error) -> Bool {
    guard let refusal = error as? RosettaError, case .unauthorized(let reason, _) = refusal else {
      return false
    }
    return reason == .expired
  }

  /// A rewritten session needs nothing here: rosetta's client has re-subscribed and its snapshot replaces the rows and
  /// the cursor. A session between generations asks again when the reader does. Anything else ends the direct read.
  private func failed(_ error: any Error) {
    if error is CancellationError { return }
    if let refusal = error as? RosettaError {
      if case .cursorExpired = refusal { return }
      if case .synchronizing = refusal { return }
    }
    giveUp(.socket)
  }

  // MARK: Pictures (item 362g)

  /// The most a tile's answer may hold: a byte and a half for each pixel of rosetta's largest `tile2x`, a 640 px
  /// square. rosettad encodes it as a WebP at quality 80, where a photograph or a screenshot is a fraction of a
  /// byte a pixel (some tens of kilobytes in all; not measured on real records yet), so a still tile is well
  /// inside it. What is past it is an animation of many frames, which stays the placeholder rather than be held
  /// whole for a square the size of a thumb. rosetta's own default is 32 MiB.
  static let tileBytes = 640 * 640 * 3 / 2
  /// The most a preview's answer may hold: the same byte and a half for each pixel of rosetta's largest
  /// `preview`, 1600 px on both edges. A preview is the picture itself when its long edge is 1600 px or less, and
  /// a legacy bundle's was encoded before these figures were written, so the room above a real picture's size is
  /// meant.
  static let previewBytes = 1600 * 1600 * 3 / 2

  /// One rendition of a recorded picture, as the bytes rosettad answered: a WebP it encoded (rosetta's client
  /// refuses any other answer before its body is read), held only up to the size's bound. `tile` asks rosetta's
  /// `tile2x` and `preview` its `preview`. A legacy bundle is asked at its sized member's own address, a recorded
  /// original through the recipe on its one member: rosetta's `imageAssetURL` decides, from the members handed
  /// to it.
  ///
  /// An expired grant renews once and reads again, as an older page does. Unlike a page, a picture that is not
  /// read ends nothing: the failure is the picture's alone, thrown as `HistoryPictureFailure`, and the session is
  /// read on. A read closed before the bytes were asked for, or while they were on their way, hands none out.
  func picture(_ picture: HistoryPicture, size: HistoryPictureSize) async throws -> Data {
    guard let client, !closed else { throw HistoryPictureFailure.closed }
    let asset = picture.asset
    let variant: ImageVariant
    let bound: Int
    switch size {
    case .tile:
      variant = .tile2x
      bound = Self.tileBytes
    case .preview:
      variant = .preview
      bound = Self.previewBytes
    }
    let data: Data
    do {
      data = try await Self.rendition(client, asset, variant, bound)
    } catch {
      guard Self.isExpired(error), await renew() else { throw pictureFailure(error) }
      do {
        data = try await Self.rendition(client, asset, variant, bound)
      } catch {
        throw pictureFailure(error)
      }
    }
    guard !closed else { throw HistoryPictureFailure.closed }
    return data
  }

  /// Off the main actor: rosetta's client counts the answer's body as it arrives.
  nonisolated private static func rendition(
    _ client: RosettaClient, _ asset: AssetRef, _ variant: ImageVariant, _ bound: Int
  ) async throws -> Data {
    try await client.image(asset, variant: variant, maxBytes: bound).bytes
  }

  /// What a picture that was not read is thrown as: never rosetta's own error, whose message names the picture's
  /// address.
  private func pictureFailure(_ error: any Error) -> HistoryPictureFailure {
    closed ? .closed : HistoryPictureFailure(error)
  }

  // MARK: The end

  /// Give the session back to the door: to the opener if it is still waiting, else to the owner.
  private func giveUp(_ reason: HistoryDirectFallback) {
    guard !closed else { return }
    let pending = opening
    opening = nil
    shutDown()
    if let pending {
      pending.resume(returning: .door(reason))
    } else {
      sink.lost(reason)
    }
  }

  func close() {
    guard !closed else { return }
    let pending = opening
    opening = nil
    shutDown()
    pending?.resume(returning: .closed)
  }

  private func shutDown() {
    closed = true
    clearDeadline()
    renewal?.cancel()
    renewal = nil
    subscription?.close()
    subscription = nil
    urlSession?.invalidateAndCancel()
    urlSession = nil
    client = nil
  }
}

// MARK: - rosetta's entries through the projection

extension HistoryProjection {
  /// The row of one of rosetta's entries; nil for one the gate refuses.
  static func row(entry: TimelineEntry) -> IndexTimelineRow? {
    row(entry: FieldProduct.JSONValue.object(entry.fields.mapValues(productJSON)))
  }

  /// Item 362f — one of rosetta's entries projected: its row, and what it carries beyond it.
  static func projected(entry: TimelineEntry) -> HistoryProjected? {
    projected(entry: FieldProduct.JSONValue.object(entry.fields.mapValues(productJSON)))
  }

  private static func productJSON(_ value: RosettaJSON) -> FieldProduct.JSONValue {
    switch value {
    case .null: return .null
    case .bool(let flag): return .bool(flag)
    case .int(let number): return .int(number)
    case .double(let number): return .double(number)
    case .string(let text): return .string(text)
    case .array(let items): return .array(items.map(productJSON))
    case .object(let fields): return .object(fields.mapValues(productJSON))
    }
  }
}

// MARK: - A recorded picture through rosetta's client (item 362g)

/// Why a picture was not read, in words a log may hold: a fixed word, an HTTP status, or a code this build names.
///
/// rosetta's own error never leaves this file. Its message names the request's path, and a picture's path holds
/// the picture's digest; a daemon's refusal carries the daemon's own message and code, which may hold anything.
/// None of those is kept.
struct HistoryPictureFailure: Error, Equatable, Sendable {
  let said: String

  /// The read was closed, or was not open yet: nothing was learned about the picture.
  static let closed = HistoryPictureFailure(said: "closed")

  init(said: String) {
    self.said = said
  }

  init(_ error: any Error) {
    said = Self.word(error)
  }

  private static func word(_ error: any Error) -> String {
    if let refusal = error as? RosettaError {
      if case .tooLarge = refusal { return "past the bound" }
      if case .unauthorized(let reason, _) = refusal { return "unauthorized, \(reason?.rawValue ?? "no reason")" }
      if case .request(let status, let code, _) = refusal {
        // a code is the daemon's own string: only one this build names is repeated
        if let code, ErrorCode.known.contains(code) { return code.rawValue }
        // rosetta's client refuses an answer that is not a WebP under the answer's own status, a 2xx
        return (200..<300).contains(status) ? "not a rendition" : "status \(status)"
      }
      return "refused"
    }
    if let failure = error as? URLError { return "network \(failure.code.rawValue)" }
    if error is CancellationError { return "cancelled" }
    return "failed"
  }
}

private extension HistoryPicture {
  /// This picture as rosetta's client asks for it. A legacy bundle hands over its sized members, so each size is
  /// asked at its member's own address; a recorded original has none, and rosettad renders its sizes on request.
  var asset: AssetRef {
    func member(_ stored: HistoryPictureMember) -> AssetRef {
      AssetRef(url: stored.url, digest: stored.digest, mediaType: stored.mediaType, byteLen: Int64(stored.byteLen))
    }
    var ref = member(base)
    if !variants.isEmpty { ref.imageVariants = variants.mapValues(member) }
    return ref
  }
}
