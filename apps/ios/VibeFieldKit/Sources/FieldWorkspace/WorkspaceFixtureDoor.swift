#if DEBUG
import FieldProduct
import Foundation

/// Simulator pixels over the shipping views and reads, with the contracts'
/// goldens at the door. No tailnet and no real spawn; absent in Release.
@MainActor
public enum WorkspaceFixtureDoor {
  public static func fixture(_ name: String) throws -> JSONValue {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
      throw FieldProductError(kind: "NOT_FOUND", message: name)
    }
    return try JSONValue.parse(Data(contentsOf: url))
  }
  public static func model() -> WorkspaceLaunch {
    WorkspaceLaunch(desktops: [
      .init(id: "dev_7d3c9b", name: "studio", platform: "darwin", online: true),
      .init(id: "fixture-windows", name: "workstation", platform: "win32", online: false),
    ], home: "dev_7d3c9b") { _, method, params in
      switch method {
      case "workspace.roots": return try fixture("workspace-roots.valid")
      case "workspace.list":
        var page = try fixture("workspace-list.valid").objectValue ?? [:]
        if params?["kinds"] == .string("dirs") {
          let rows = page["entries"]?.arrayValue?.filter { $0["kind"] == .string("dir") } ?? []
          page["entries"] = .array(rows); page["total"] = .int(Int64(rows.count))
        }
        return .object(page)
      case "workspace.search": return try fixture("workspace-search.valid")
      case "agent.catalog": return try fixture("agent-catalog.valid")
      case "agent.spawn":
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-workspace=spawning") {
          try await Task.sleep(for: .seconds(60))
        }
        throw FieldProductError(kind: "UNAVAILABLE", message: "Fixture: no agent is launched")
      default: throw FieldProductError(kind: "NOT_FOUND", message: "Fixture has no such door")
      }
    }
  }
}
#endif
