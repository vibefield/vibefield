import FieldProduct
import Foundation
import Observation

/// A sheet's choices and reads; only the daemon's fold adds a new field row.
@MainActor
@Observable
public final class WorkspaceLaunch {
  public typealias Request = @MainActor (String, String, JSONValue?) async throws -> JSONValue
  public private(set) var desktops: [WorkspaceDesktop]
  public private(set) var selected: String?
  public private(set) var reader: WorkspaceReads?
  public private(set) var agents: [AgentCatalogRow] = []
  public var provider: String = ""
  public private(set) var folder: WorkspaceChoice?
  public private(set) var spawning = false
  public private(set) var message: String?
  @ObservationIgnored private let request: Request
  @ObservationIgnored private var readers: [String: WorkspaceReads] = [:]
  @ObservationIgnored private var epoch = 0

  public init(desktops: [WorkspaceDesktop], home: String?, request: @escaping Request) {
    self.desktops = desktops; self.selected = home ?? desktops.first?.id; self.request = request
  }
  public var desktop: WorkspaceDesktop? { desktops.first { $0.id == selected } }
  public var canSpawn: Bool {
    !spawning && desktop?.online == true && folder?.device == selected
      && agents.contains { $0.id == provider && $0.canSpawn }
  }

  public func update(_ desktops: [WorkspaceDesktop]) {
    self.desktops = desktops
    for (id, reader) in readers { reader.setOnline(desktops.first { $0.id == id }?.online == true) }
  }

  public func select(_ device: String) async {
    guard !spawning, let desktop = desktops.first(where: { $0.id == device }) else { return }
    epoch += 1; let ticket = epoch
    if selected != device { folder = nil }
    selected = device; agents = []; provider = ""; message = nil
    let reader = readers[device] ?? WorkspaceReads(device: device, name: desktop.name) { [request] method, params in
      try await request(device, method, params)
    }
    readers[device] = reader; self.reader = reader
    reader.setOnline(desktop.online)
    await reader.refreshRoots()
    guard ticket == epoch, desktop.online, !Task.isCancelled else { return }
    do {
      let catalog = try AgentCatalogResult(json: await request(device, "agent.catalog", AgentCatalogParams.phone.json))
      guard ticket == epoch, !Task.isCancelled else { return }
      agents = catalog.catalog.filter { $0.canSpawn && $0.phone != false }
      provider = agents.first?.id ?? ""
      if agents.isEmpty { message = "This desktop offers no agents to launch" }
    } catch { if ticket == epoch { message = (error as? FieldProductError)?.message ?? String(describing: error) } }
  }

  public func chooseCurrentFolder() -> Bool {
    guard let choice = reader?.choice, choice.device == selected else { return false }
    folder = choice; message = nil; return true
  }

  /// Non-idempotent: one tap, one ask. A lost reply is never retried here.
  public func spawn() async -> Bool {
    guard canSpawn, let folder else { return false }
    spawning = true; message = nil
    defer { spawning = false }
    do {
      let result = try await request(folder.device, "agent.spawn", AgentSpawnParams(provider: provider, cwd: folder.path).json)
      guard result["session"]?["runtimeRunId"]?.stringValue != nil else {
        throw WireDecodeError(shape: "agent.spawn", reason: "missing run receipt")
      }
      return true
    } catch {
      if let refusal = error as? FieldProductError, ["UNAVAILABLE", "TIMEOUT"].contains(refusal.kind) {
        message = "The desktop did not confirm the launch. Check the field before trying again."
      } else { message = (error as? FieldProductError)?.message ?? String(describing: error) }
      return false
    }
  }
}
