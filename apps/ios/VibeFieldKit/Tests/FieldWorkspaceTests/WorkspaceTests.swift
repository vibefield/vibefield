import FieldProduct
import Foundation
import Testing
@testable import FieldWorkspace

func workspaceFixture(_ name: String) throws -> JSONValue {
  let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
  return try JSONValue.parse(Data(contentsOf: url))
}
private func changed(_ value: JSONValue, _ fields: [String: JSONValue]) -> JSONValue {
  .object((value.objectValue ?? [:]).merging(fields) { _, new in new })
}
private let desktopID = "dev_7d3c9b"

@Suite struct WorkspaceShapeTests {
  @Test func bothSidesReadTheSameGoldensAndPreserveFutureFields() throws {
    let json = try workspaceFixture("workspace-roots.valid")
    let roots = try WorkspaceRootsResult(json: changed(json, ["future": .bool(true)]))
    #expect(roots.roots.count == 4)
    #expect(roots.roots[1].missing)
    #expect(roots.roots[2].browse == "home")
    #expect(roots.unknownFields == ["future"])
    let bytes = try JSONEncoder().encode(roots)
    #expect(try JSONValue.parse(bytes) == roots.wire)
    #expect(try JSONDecoder().decode(WorkspaceRootsResult.self, from: bytes) == roots)
    let page = try WorkspaceListResult(json: workspaceFixture("workspace-list.valid"))
    #expect(page.total == 4)
    #expect(page.entries.first?.childCount == 31)
    #expect(page.entries[1].childCount == nil)
    #expect(page.entries[2].kind == "symlink")
    let search = try WorkspaceSearchResult(json: workspaceFixture("workspace-search.valid"))
    #expect(search.complete && !search.clipped)
    #expect(search.hits.first?.relativePath == "Projects/project100/vibe-field")
  }

  @Test func requestsUseRelativePathsAndCatalogExplicitlyOffersSpawn() throws {
    let list = try workspaceFixture("workspace-list-params.valid")
    let params = try JSONDecoder().decode(WorkspaceListParams.self, from: JSONEncoder().encode(list))
    #expect(params.json["path"] == list["path"])
    #expect(params.json["kinds"] == list["kinds"])
    let search = try workspaceFixture("workspace-search-params.valid")
    let searchParams = try JSONDecoder().decode(WorkspaceSearchParams.self, from: JSONEncoder().encode(search))
    #expect(searchParams.json["q"] == search["q"])
    let catalog = try AgentCatalogResult(json: workspaceFixture("agent-catalog.valid"))
    #expect(catalog.catalog.first?.canSpawn == true)
    let future = try AgentCatalogRow(json: .object(["id": .string("future"), "label": .string("Future"), "status": .string("preview")]))
    #expect(!future.canSpawn)
  }
}

@MainActor
@Suite struct WorkspaceReadsTests {
  @Test func rootsListPagesSearchAndCopyKeepTheDoorsPaths() async throws {
    let rootJSON = try workspaceFixture("workspace-roots.valid")
    let first = try workspaceFixture("workspace-list.valid")
    let search = try workspaceFixture("workspace-search.valid")
    var asks: [(String, JSONValue?)] = []
    let reader = WorkspaceReads(device: desktopID, name: "studio") { method, params in
      asks.append((method, params))
      switch method {
      case "workspace.roots": return rootJSON
      case "workspace.list":
        if params?["cursor"] == .string("next") {
          return changed(first, ["entries": .array([changed(first["entries"]!.arrayValue![0], ["id": .int(999), "path": .string("/exact/from/server")])])])
        }
        return changed(first, ["nextCursor": .string("next"), "clipped": .bool(true)])
      case "workspace.search": return changed(search, ["complete": .bool(false), "clipped": .bool(true)])
      default: throw FieldProductError(kind: "NOT_FOUND", message: method)
      }
    }
    await reader.refreshRoots()
    #expect(reader.recent.map(\.name) == ["vibe-field", "old-spike"])
    let home = try #require(reader.roots.first { $0.browse == "home" })
    await reader.open(home, path: "Projects/project100")
    #expect(reader.choice?.path == first["path"]?.stringValue)
    #expect(reader.entries.count == 4 && reader.clipped)
    await reader.more()
    #expect(asks.last?.1?["cursor"] == .string("next"))
    #expect(reader.entries.count == 5 && reader.nextCursor == nil)
    var copied = ""
    reader.copyPath(reader.entries.last!.path) { copied = $0 }
    #expect(copied == "/exact/from/server")
    await reader.search("vibe")
    #expect(asks.last?.1?["path"] == .string("Projects/project100"))
    #expect(!reader.complete && reader.clipped)
    #expect(reader.hits.count == 2)
    reader.copyPath("C:\\Users\\Ada\\a folder") { copied = $0 }
    #expect(copied == "C:\\Users\\Ada\\a folder")
  }

  @Test func unavailableOfflineRefusedAndMissingStayDistinct() async throws {
    let roots = try workspaceFixture("workspace-roots.valid")
    var failure: FieldProductError?
    let reader = WorkspaceReads(device: desktopID, name: "studio") { _, _ in
      if let failure { throw failure }; return roots
    }
    await reader.refreshRoots()
    let retained = reader.roots
    failure = FieldProductError(kind: "UNAVAILABLE", message: "restarting", retryable: true,
      details: .object(["service": .string("workspace"), "state": .string("restarting")]))
    await reader.refreshRoots()
    #expect(reader.state == .unavailable("restarting"))
    #expect(reader.message == "Files are restarting on studio")
    #expect(reader.roots == retained)
    reader.setOnline(false)
    #expect(reader.message?.hasPrefix("studio is asleep · read ") == true)
    #expect(reader.choice == nil)
    await reader.open(retained[1])
    #expect(reader.root == nil)
    reader.setOnline(true)
    failure = FieldProductError(kind: "FORBIDDEN_SCOPE", message: "This account cannot browse")
    await reader.refreshRoots()
    #expect(reader.state == .refused("This account cannot browse"))
  }

  @Test func aLateFolderAnswerCannotReplaceNewNavigation() async throws {
    let roots = try WorkspaceRootsResult(json: workspaceFixture("workspace-roots.valid"))
    let page = try workspaceFixture("workspace-list.valid")
    var reply: CheckedContinuation<JSONValue, Never>?
    let reader = WorkspaceReads(device: desktopID, name: "studio") { _, params in
      if params?["path"] == .string("old") { return await withCheckedContinuation { reply = $0 } }
      return page
    }
    let pending = Task { await reader.open(roots.roots[2], path: "old") }
    while reply == nil { await Task.yield() }
    await reader.open(roots.roots[2], path: "new")
    reply?.resume(returning: changed(page, ["path": .string("/stale")]))
    await pending.value
    #expect(reader.relativePath == "new")
    #expect(reader.absolutePath != "/stale")
    #expect(reader.state == .ready)
  }
}

@MainActor
@Suite struct WorkspaceLaunchTests {
  @Test func selectionSpawnsOnThatDesktopAndWaitsForItsRealReceipt() async throws {
    let roots = try workspaceFixture("workspace-roots.valid")
    let page = try workspaceFixture("workspace-list.valid")
    let catalog = try workspaceFixture("agent-catalog.valid")
    var asks: [(String, String, JSONValue?)] = []
    var response: CheckedContinuation<JSONValue, Never>?
    let model = WorkspaceLaunch(desktops: [
      .init(id: "home", name: "home", platform: "darwin", online: true),
      .init(id: desktopID, name: "studio", platform: "win32", online: true),
    ], home: "home") { device, method, params in
      asks.append((device, method, params))
      switch method {
      case "workspace.roots": return roots
      case "workspace.list": return page
      case "agent.catalog": return catalog
      case "agent.spawn": return await withCheckedContinuation { response = $0 }
      default: throw FieldProductError(kind: "NOT_FOUND", message: method)
      }
    }
    #expect(model.selected == "home")
    await model.select(desktopID)
    let reader = try #require(model.reader)
    let root = try #require(reader.roots.first { $0.browse == "home" })
    await reader.open(root, path: "Projects/project100")
    #expect(model.chooseCurrentFolder())
    #expect(model.canSpawn)
    let pending = Task { await model.spawn() }
    while response == nil { await Task.yield() }
    #expect(!model.canSpawn)
    #expect(await model.spawn() == false)
    #expect(asks.last?.0 == desktopID)
    #expect(asks.last?.2?["cwd"] == page["path"])
    #expect(asks.filter { $0.1 == "agent.spawn" }.count == 1)
    response?.resume(returning: .object(["session": .object(["runtimeRunId": .string("real-receipt")])]))
    #expect(await pending.value)
    await model.select("home")
    #expect(model.folder == nil && !model.canSpawn)
  }
}
