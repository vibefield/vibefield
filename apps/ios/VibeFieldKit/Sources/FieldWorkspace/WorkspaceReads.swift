import FieldProduct
import Foundation
import Observation

public struct WorkspaceDesktop: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let platform: String?
  public let online: Bool
  public init(id: String, name: String, platform: String?, online: Bool) {
    self.id = id; self.name = name; self.platform = platform; self.online = online
  }
}

public struct WorkspaceChoice: Equatable, Sendable {
  public let device: String
  public let rootId: String
  public let relativePath: String
  /// Exactly the answer's absolute path. Never reconstructed for copy/spawn.
  public let path: String
}

@MainActor
@Observable
public final class WorkspaceReads {
  public enum State: Equatable {
    case idle, loading, ready, offline
    case unavailable(String), refused(String)
  }
  public typealias Request = @MainActor (String, JSONValue?) async throws -> JSONValue
  public let device: String
  public let name: String
  public private(set) var state: State = .idle
  public private(set) var roots: [WorkspaceRoot] = []
  public private(set) var rootsClipped = false
  public private(set) var root: WorkspaceRoot?
  public private(set) var relativePath = ""
  public private(set) var absolutePath: String?
  public private(set) var entries: [WorkspaceEntry] = []
  public private(set) var hits: [WorkspaceEntry] = []
  public private(set) var query = ""
  public private(set) var nextCursor: String?
  public private(set) var clipped = false
  public private(set) var complete = true
  public private(set) var total: Int64 = 0
  public private(set) var readAt: Date?
  public private(set) var note: String?
  public private(set) var showFiles = false
  @ObservationIgnored private let request: Request
  @ObservationIgnored private var epoch = 0
  @ObservationIgnored private var rootsEpoch = 0
  @ObservationIgnored private var online = true

  public init(device: String, name: String, request: @escaping Request) {
    self.device = device; self.name = name; self.request = request
  }

  public var recent: [WorkspaceRoot] {
    roots.filter { $0.kind == "place" }.sorted { ($0.lastActiveAt ?? "") > ($1.lastActiveAt ?? "") }
  }
  public var browse: [WorkspaceRoot] { roots.filter { $0.kind != "place" } }
  public var choice: WorkspaceChoice? {
    guard state == .ready, online, let root, !root.missing, let absolutePath else { return nil }
    return WorkspaceChoice(device: device, rootId: root.id, relativePath: relativePath, path: absolutePath)
  }
  public var message: String? {
    switch state {
    case .idle: return nil
    case .loading: return "Reading folders…"
    case .ready: return note
    case .offline:
      let stamp = readAt.map { " · read \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
      return "\(name) is asleep\(stamp)"
    case .unavailable(let state):
      switch state {
      case "starting": return "Files are starting on \(name)"
      case "restarting": return "Files are restarting on \(name)"
      default: return "Files are unavailable on \(name) (\(state))"
      }
    case .refused(let reason): return reason
    }
  }

  public func setOnline(_ value: Bool) {
    online = value
    if !value { epoch += 1; rootsEpoch += 1; state = .offline }
  }

  public func refreshRoots() async {
    guard online else { state = .offline; return }
    rootsEpoch += 1
    let ticket = rootsEpoch
    state = .loading
    do {
      let result = try WorkspaceRootsResult(json: await request("workspace.roots", .object([:])))
      guard ticket == rootsEpoch, online, !Task.isCancelled else { return }
      roots = result.roots.filter { $0.device == device }
      rootsClipped = result.clipped
      note = result.droppedRows.isEmpty ? nil : "Some folders could not be read"
      if let selected = root {
        root = roots.first { $0.id == selected.id }
        if root?.missing != false { absolutePath = nil }
      }
      readAt = Date(); state = .ready
    } catch { if ticket == rootsEpoch, !Task.isCancelled { failed(error) } }
  }

  public func showRoots() {
    epoch += 1; root = nil; relativePath = ""; absolutePath = nil
    entries = []; hits = []; query = ""; nextCursor = nil
    state = online ? .ready : .offline
  }

  public func open(_ root: WorkspaceRoot, path: String = "") async {
    guard online, !root.missing else { return }
    epoch += 1
    self.root = root; relativePath = path; absolutePath = nil
    entries = []; hits = []; query = ""; nextCursor = nil
    await page(cursor: nil, epoch: epoch)
  }

  public func enter(_ entry: WorkspaceEntry) async {
    guard state == .ready, let root, entry.kind == "dir" else { return }
    let path = entry.relativePath ?? [relativePath, entry.name].filter { !$0.isEmpty }.joined(separator: "/")
    await open(root, path: path)
  }

  public func more() async {
    guard state == .ready, query.isEmpty, let nextCursor else { return }
    await page(cursor: nextCursor, epoch: epoch)
  }

  public func filter(files: Bool) async {
    guard files != showFiles else { return }
    showFiles = files
    if !query.isEmpty { await search(query); return }
    if let root { await open(root, path: relativePath) }
  }

  public func search(_ text: String) async {
    guard online, let root else { return }
    epoch += 1
    let ticket = epoch
    query = text.trimmingCharacters(in: .whitespacesAndNewlines)
    hits = []; complete = true; clipped = false
    if query.isEmpty { entries = []; await page(cursor: nil, epoch: ticket); return }
    state = .loading
    do {
      let params = WorkspaceSearchParams(rootId: root.id, path: relativePath, q: query, kinds: kinds)
      let result = try WorkspaceSearchResult(json: await request("workspace.search", params.json))
      guard ticket == epoch, online, !Task.isCancelled else { return }
      guard result.rootId == root.id else { throw WireDecodeError(shape: "workspace.search", reason: "wrong root") }
      hits = result.hits; clipped = result.clipped; complete = result.complete
      note = result.droppedRows.isEmpty ? nil : "Some results could not be read"
      readAt = Date(); state = .ready
    } catch { if ticket == epoch, !Task.isCancelled { failed(error) } }
  }

  /// The copy sink is injected so tests witness the exact answer's bytes.
  public func copyPath(_ path: String, to sink: (String) -> Void) { sink(path) }

  private var kinds: String { showFiles ? "all" : "dirs" }
  private func page(cursor: String?, epoch ticket: Int) async {
    guard online, let root else { return }
    state = .loading
    do {
      let params = WorkspaceListParams(rootId: root.id, path: relativePath, cursor: cursor, kinds: kinds)
      let result = try WorkspaceListResult(json: await request("workspace.list", params.json))
      guard ticket == epoch, online, !Task.isCancelled else { return }
      guard result.rootId == root.id else { throw WireDecodeError(shape: "workspace.list", reason: "wrong root") }
      if cursor == nil { entries = [] }
      let known = Set(entries.map(\.path))
      entries.append(contentsOf: result.entries.filter { !known.contains($0.path) })
      absolutePath = result.path; nextCursor = result.nextCursor
      clipped = result.clipped; total = result.total
      note = result.droppedRows.isEmpty ? nil : "Some entries could not be read"
      readAt = Date(); state = .ready
    } catch { if ticket == epoch, !Task.isCancelled { failed(error) } }
  }

  private func failed(_ error: any Error) {
    if let refusal = error as? FieldProductError {
      if refusal.kind == "UNAVAILABLE" {
        if refusal.details?["service"]?.stringValue == "workspace" {
          state = .unavailable(refusal.details?["state"]?.stringValue ?? "unavailable")
        } else { state = .offline }
      } else { state = .refused(refusal.message) }
    } else { state = .refused(String(describing: error)) }
  }
}
