import FieldProduct
import Foundation
import Testing

@testable import FieldWorkspace

// PJ-7 and item 586 — the launch sheet (DESIGN.md §8, "The phone's launch sheet asks two things"): WHERE comes filled
// from the recipe's place (else the newest launchable place on the sheet's desktop, else Browse opens by itself); the
// recent places are pills, a project's on every desktop; Browse opens beside the chosen folder, with its crumbs and its
// tags; WHO is buds under the sheet's profile, and a bud it holds no sign-in for is never chosen; the native profile
// reads Default; a spawn names a place by ref (a path only from Browse) and sends no model selection. Over the
// contracts' goldens.

private let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"
private let laptop = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9"

private func place(
  _ id: String, on device: String, name: String, lastAt: Int64, reason: String? = nil, last: String = "",
  path: String? = nil
) -> LaunchPlace {
  LaunchPlace(
    ref: PlaceRef(device: device, placeId: id), name: name, branch: nil, desktop: device, reason: reason,
    lastAt: lastAt, last: last, path: path)
}

private let vibeField = place(
  "pl_4c1e9a0b7d2f6e8a1b3c5d7e", on: studio, name: "vibe-field", lastAt: 300, last: "2h",
  path: "/Users/ada/Projects/vibe-field")
private let docs = place("pl_77d3f2a1c9e0b4d6f8a2c4e6", on: laptop, name: "vf-docs", lastAt: 200)
private let older = place("pl_old", on: studio, name: "old-spike", lastAt: 100)
private let gone = place("pl_gone", on: studio, name: "gone", lastAt: 900, reason: "folder gone")

@MainActor
private final class Desk {
  var asked: [(device: String, method: String, params: JSONValue?)] = []
  var spawnReply: JSONValue = .object(["session": .object(["runtimeRunId": .string("run-1")])])
  /// fix7 — methods that do not answer until `release()`, and ones refused
  var stalled: Set<String> = []
  var refused: [String: FieldProductError] = [:]
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func release() {
    let held = waiting
    waiting = []
    for continuation in held { continuation.resume() }
  }

  func answer(_ device: String, _ method: String, _ params: JSONValue?) async throws -> JSONValue {
    asked.append((device, method, params))
    if stalled.contains(method) { await withCheckedContinuation { waiting.append($0) } }
    if let refusal = refused[method] { throw refusal }
    switch method {
    case "workspace.roots":
      // the golden's roots, on the desktop asked
      var answer = try #require(try workspaceFixture("workspace-roots.valid").objectValue)
      answer["roots"] = .array((answer["roots"]?.arrayValue ?? []).map { root in
        var fields = root.objectValue ?? [:]
        fields["device"] = .string(device)
        return .object(fields)
      })
      return .object(answer)
    case "workspace.list": return try workspaceFixture("workspace-list.valid")
    case "agent.catalog": return try workspaceFixture("agent-catalog.valid")
    case "agents.profileSets.list": return try workspaceFixture("agents-profile-sets.valid")
    case "agent.spawn": return spawnReply
    // item 587 — the shell's receipt, as TerminalCreateResult leads it
    case "terminal.create": return .object(["sessionId": .string("term-1")])
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func launch() -> WorkspaceLaunch {
    WorkspaceLaunch(desktops: [
      .init(id: studio, name: "studio", platform: "darwin", online: true),
      .init(id: laptop, name: "laptop", platform: "win32", online: true),
    ], home: studio) { [unowned self] device, method, params in
      try await self.answer(device, method, params)
    }
  }

  func last(_ method: String) -> (device: String, method: String, params: JSONValue?)? {
    asked.last { $0.method == method }
  }
}

private func recipe() throws -> ProjectRecipe {
  try #require(try ProjectSummary(json: try workspaceFixture("project-summary.recipe-place")).recipe)
}

/// The golden catalog as the sheet keeps it: the agents a desktop offers a phone.
private func catalog() throws -> [AgentCatalogRow] {
  try AgentCatalogResult(json: try workspaceFixture("agent-catalog.valid")).catalog
    .filter { $0.canSpawn && $0.phone != false }
}

private func profileSets() throws -> [AgentProfileSet] {
  try AgentProfileSetsResult(json: try workspaceFixture("agents-profile-sets.valid")).sets
}

private func roots() throws -> [WorkspaceRoot] {
  try WorkspaceRootsResult(json: try workspaceFixture("workspace-roots.valid")).roots
}

@MainActor
private func settle(_ what: String, _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: .seconds(5))
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

@Suite("PJ-7 and item 586 — the launch sheet's decisions")
struct LaunchDecisionTests {
  @Test("the usual place: the recipe's, else the newest launchable on the sheet's desktop, else none")
  func usualPlace() throws {
    let places = [gone, docs, vibeField, older]
    let recipe = try recipe()
    #expect(LaunchModel.usualPlace(recipe: recipe, places: places, desktop: laptop, online: [studio, laptop]) == vibeField)
    // the recipe's place on a desktop that does not answer: the newest on the sheet's desktop
    #expect(LaunchModel.usualPlace(recipe: recipe, places: places, desktop: laptop, online: [laptop]) == docs)
    // never a place that cannot take a launch, however new
    #expect(LaunchModel.usualPlace(recipe: nil, places: places, desktop: studio, online: [studio]) == vibeField)
    #expect(LaunchModel.usualPlace(recipe: nil, places: [gone], desktop: studio, online: [studio]) == nil)
    #expect(LaunchModel.usualPlace(recipe: nil, places: places, desktop: studio, online: []) == nil)
  }

  @Test("WHERE's pills: launchable places on desktops that answer, newest first; from the field, the sheet's desktop's alone")
  func recentPlaces() {
    let places = [gone, docs, vibeField, older]
    let both: Set<String> = [studio, laptop]
    #expect(
      LaunchModel.recentPlaces(places, desktop: studio, online: both, everyDesktop: false) == [vibeField, older])
    #expect(
      LaunchModel.recentPlaces(places, desktop: studio, online: both, everyDesktop: true) == [vibeField, older, docs],
      "a project's places on every desktop, the sheet's desktop's first")
    #expect(
      LaunchModel.recentPlaces(places, desktop: laptop, online: both, everyDesktop: true) == [docs, vibeField, older])
    #expect(
      LaunchModel.recentPlaces(places, desktop: studio, online: [studio], everyDesktop: true) == [vibeField, older],
      "never a desktop that does not answer")
    #expect(
      LaunchModel.recentPlaces(places, desktop: studio, online: both, everyDesktop: true, limit: 1) == [vibeField])
  }

  @Test("the sheet's profile: the one wanted, else one that runs the agent wanted, the default first")
  func sheetProfile() throws {
    let sets = try profileSets()
    #expect(LaunchModel.sheetProfile(sets, wanted: [nil, "work"], for: "claude")?.id == "work", "the bloom's, whatever it runs")
    #expect(
      LaunchModel.sheetProfile(sets, wanted: ["work-7f3a"], for: "claude")?.id == "native",
      "a recipe's profile this desktop lacks: one that runs claude")
    #expect(LaunchModel.sheetProfile(sets, wanted: [nil], for: "codex")?.id == "work", "the desktop's default runs codex")
    #expect(LaunchModel.sheetProfile(sets, wanted: [], for: nil)?.id == "work")
    #expect(LaunchModel.sheetProfile(sets, wanted: [], for: "pi")?.id == "native", "only the agents' own folders run pi")
    #expect(LaunchModel.sheetProfile([], wanted: ["work"], for: "claude") == nil)
    let native = try #require(sets.first { $0.kind == "native" })
    #expect(LaunchModel.profileLabel(native) == "Default", "Q5: the wire's This Mac reads Default on the phone")
  }

  @Test("a profile runs the agents it holds a sign-in for; the agents' own folders run every one")
  func signIns() throws {
    let sets = try profileSets()
    let native = try #require(sets.first { $0.id == "native" })
    let work = try #require(sets.first { $0.id == "work" })
    #expect(LaunchModel.signedIn("claude", under: native))
    #expect(LaunchModel.signedIn("codex", under: work))
    #expect(!LaunchModel.signedIn("claude", under: work))
    #expect(LaunchModel.signedIn("claude", under: nil), "no profile read: the desktop's default decides")
  }

  @Test("the agent a sheet comes chosen with: the first wanted that the profile runs, else the first it runs")
  func firstAgent() throws {
    let agents = try catalog()
    let work = try #require(try profileSets().first { $0.id == "work" })
    #expect(
      LaunchModel.firstAgent(agents, profile: work, wanted: [nil, "claude", nil]) == "codex",
      "Work holds no sign-in for claude")
    #expect(LaunchModel.firstAgent(agents, profile: work, wanted: ["hermes"]) == "hermes")
    #expect(LaunchModel.firstAgent(agents, profile: nil, wanted: [nil, nil, "grok"]) == "grok")
    let claudeOnly = agents.filter { $0.id == "claude" }
    #expect(
      LaunchModel.firstAgent(claudeOnly, profile: work, wanted: []) == "claude",
      "none the profile runs: the first offered, whose Start is off")
    #expect(LaunchModel.firstAgent([], profile: work, wanted: ["codex"]) == nil)
    #expect(LaunchModel.wantedAgent(agents, wanted: [nil, "acp", "kimi"]) == "kimi", "acp is offered no phone")
  }

  @Test("WHO says what it waits on in the buds' place, never 'No agent available' before the desktop answers")
  func whoWords() throws {
    let agents = try catalog()
    #expect(LaunchModel.whoRow(agents, read: true, failed: false, online: false, desktop: "studio") == "studio is asleep")
    #expect(LaunchModel.whoRow([], read: true, failed: true, online: true, desktop: "studio") == "Agents could not be read")
    #expect(LaunchModel.whoRow([], read: false, failed: false, online: true, desktop: "studio") == "Reading agents…")
    #expect(
      LaunchModel.whoRow([], read: true, failed: false, online: true, desktop: "studio")
        == "studio offers no agents to launch")
    #expect(LaunchModel.whoRow(agents, read: true, failed: false, online: true, desktop: "studio") == nil)
  }

  @Test("Start's words: the agent small, why it cannot run, the whole sentence for a screen reader")
  func startWords() {
    #expect(LaunchModel.startLine(agent: "Claude Code", runs: true, profile: "Work", starting: false) == "CLAUDE CODE")
    #expect(
      LaunchModel.startLine(agent: "Claude Code", runs: true, profile: "Work", starting: true)
        == "STARTING CLAUDE CODE…")
    #expect(
      LaunchModel.startLine(agent: "Claude Code", runs: false, profile: "Work", starting: false)
        == "NO SIGN-IN AS WORK")
    #expect(
      LaunchModel.startSentence(agent: "Claude Code", folder: "vibe-field", starting: false)
        == "Start Claude Code in vibe-field")
    #expect(LaunchModel.startSentence(agent: "Claude Code", folder: nil, starting: false) == "Choose a folder first")
  }

  @Test("paths as the sheet draws them: the home as ~ on either separator, never a prefix that is not a folder")
  func paths() {
    #expect(LaunchModel.shown("/Users/ada/Projects/vibe-field", home: "/Users/ada") == "~/Projects/vibe-field")
    #expect(LaunchModel.shown("/Users/ada", home: "/Users/ada") == "~")
    #expect(LaunchModel.shown("/Users/adam/notes", home: "/Users/ada") == "/Users/adam/notes")
    #expect(LaunchModel.shown(#"C:\Users\ada\Projects"#, home: #"C:\Users\ada"#) == #"~\Projects"#)
    #expect(LaunchModel.shown("/Volumes/Backup", home: nil) == "/Volumes/Backup")
    #expect(
      LaunchModel.whereLine(path: "/Users/ada/Projects/vibe-field", branch: "rd-5a", last: "2h", home: "/Users/ada")
        == "~/Projects/vibe-field · rd-5a · 2h")
    #expect(LaunchModel.whereLine(path: nil, branch: nil, last: "2h", home: nil) == "2h")
    #expect(LaunchModel.whereLine(path: nil, branch: nil, last: "", home: nil) == nil)
    #expect(
      LaunchModel.parentShown("/Users/ada/Projects/vibe-field/packages", home: "/Users/ada") == "~/Projects/vibe-field")
    #expect(LaunchModel.lastStep(of: #"C:\Users\ada\Projects"#) == "Projects")
    #expect(LaunchModel.parent("Projects/vibe-field") == "Projects")
    #expect(LaunchModel.parent("Projects") == "")
  }

  @Test("Browse's crumbs: the desktop, ~, each folder; folded to … past four steps and 42 characters")
  func crumbs() throws {
    let home = try #require(try roots().first { $0.browse == "home" })
    #expect(LaunchModel.crumbs(desktop: "studio", root: nil, path: "").map(\.label) == ["studio"])
    #expect(
      LaunchModel.crumbs(desktop: "studio", root: home, path: "Projects").map(\.label) == ["studio", "~", "Projects"])
    let deep = LaunchModel.crumbs(desktop: "studio", root: home, path: "Projects/vibe-field/packages/fieldd")
    #expect(deep.map(\.label) == ["studio", "…", "packages", "fieldd"])
    try #require(deep.count == 4)
    #expect(deep[1].path == "Projects/vibe-field", "the fold opens the folder it stands for")
    #expect(deep[0].rootId == nil, "the desktop's own step is its places")
    #expect(LaunchModel.browseTitle(desktop: "studio", root: home, path: "") == "Home")
    #expect(LaunchModel.browseTitle(desktop: "studio", root: home, path: "Projects/vibe-field") == "vibe-field")
    #expect(LaunchModel.browseTitle(desktop: "studio", root: nil, path: "") == "studio")
  }

  @Test("Browse opens beside the chosen folder: a Browse folder in its root, a place under the root that holds it")
  func browseStart() throws {
    let roots = try roots()
    let home = try #require(roots.first { $0.browse == "home" })
    let backup = try #require(roots.first { $0.browse == "volume" })
    let folder = WorkspaceChoice(
      device: studio, rootId: home.id, relativePath: "Projects/workbench", path: "/Users/ada/Projects/workbench")
    #expect(
      LaunchModel.browseStart(folder: folder, placePath: nil, roots: roots)
        == LaunchModel.BrowseAt(root: home, path: "Projects"))
    #expect(
      LaunchModel.browseStart(folder: nil, placePath: "/Users/ada/Projects/vibe-field", roots: roots)
        == LaunchModel.BrowseAt(root: home, path: "Projects"))
    #expect(
      LaunchModel.browseStart(folder: nil, placePath: "/Volumes/Backup/Archive/2024", roots: roots)
        == LaunchModel.BrowseAt(root: backup, path: "Archive"))
    #expect(
      LaunchModel.browseStart(folder: nil, placePath: "/opt/elsewhere", roots: roots)
        == LaunchModel.BrowseAt(root: home, path: ""), "a place under no root: the home's top")
    #expect(LaunchModel.browseStart(folder: nil, placePath: nil, roots: roots.filter { $0.browse != "home" }) == nil)
  }

  @Test("a Browse row's tag: CHOSEN for the chosen folder, else a recent place's age")
  func browseTags() {
    let path = "/Users/ada/Projects/vibe-field"
    #expect(LaunchModel.browseTag(path, chosen: path, places: [vibeField]) == "CHOSEN")
    #expect(LaunchModel.browseTag(path, chosen: nil, places: [vibeField]) == "2H")
    #expect(LaunchModel.browseTag("/Users/ada/Projects/other", chosen: nil, places: [vibeField]) == nil)
  }

  @Test("item 587 — Terminal's words: elsewhere and older in the sheet's own, a lost reply as Start's, the rest fieldd's")
  func shellWords() {
    let notHere = FieldProductError(
      kind: "PRECONDITION_FAILED",
      message: "that place is on another desktop; a desktop starts agents only in its own places",
      details: .object(["reason": .string("not-here"), "place": vibeField.ref.json]))
    #expect(
      LaunchModel.shellRefusal(notHere, desktop: "studio")
        == "That folder is on another desktop. Choose a folder on studio.")
    #expect(
      LaunchModel.shellRefusal(notHere, desktop: nil)
        == "That folder is on another desktop. Choose a folder on this desktop.", "the stand-in, inside a sentence")
    let older = FieldProductError(
      kind: "FORBIDDEN_SCOPE", message: "opening a terminal under a profile requires agent.spawn",
      details: .object(["required": .string("agent.spawn")]))
    #expect(
      LaunchModel.shellRefusal(older, desktop: "studio")
        == "studio needs an update before this phone can open a terminal there.")
    #expect(
      LaunchModel.shellRefusal(older, desktop: nil)
        == "This desktop needs an update before this phone can open a terminal there.")
    let lost = FieldProductError(
      kind: "TIMEOUT", message: "studio did not answer terminal.create within 20 s", retryable: true)
    #expect(LaunchModel.shellRefusal(lost, desktop: "studio") == LaunchModel.unconfirmed)
    let gone = FieldProductError(
      kind: "PRECONDITION_FAILED", message: "the place's folder is gone from this device",
      details: .object(["reason": .string("missing-cwd"), "place": vibeField.ref.json]))
    #expect(LaunchModel.shellRefusal(gone, desktop: "studio") == "the place's folder is gone from this device")
    #expect(LaunchModel.shellSentence(folder: "vibe-field", opening: false) == "Open a terminal in vibe-field")
    #expect(LaunchModel.shellSentence(folder: "vibe-field", opening: true) == "Opening a terminal in vibe-field")
    #expect(LaunchModel.shellSentence(folder: nil, opening: false) == "Choose a folder first")
  }
}

@MainActor
@Suite("PJ-7 and item 586 — the launch sheet asks and launches")
struct LaunchSheetTests {
  @Test("from a project: its place and agent come chosen under a profile that runs it; the spawn names the place and no model")
  func fromAProject() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs, older], recipe: try recipe()))
    #expect(model.place == vibeField)
    #expect(model.selected == studio)
    #expect(!model.needsFolder)
    #expect(model.provider == "claude", "the recipe's agent")
    #expect(model.profileSet == "native", "the recipe's profile is not on this desktop: one that runs claude")
    #expect(model.profileWords == "AS DEFAULT")
    #expect(
      model.whereChoices.map(\.id) == [vibeField, older, docs].map { LaunchWhere.place($0).id },
      "a project's places on every desktop, the sheet's desktop's first")
    #expect(model.whereLine == "~/Projects/vibe-field · 2h")
    #expect(model.canSpawn)
    #expect(model.startSentence == "Start Claude Code in vibe-field")
    #expect(await model.spawn())
    let spawn = try #require(desk.last("agent.spawn"))
    #expect(spawn.device == studio)
    #expect(spawn.params?["place"] == vibeField.ref.json)
    #expect(spawn.params?["cwd"] == nil)
    #expect(spawn.params?["profileSet"] == .string("native"))
    #expect(spawn.params?["modelSelection"] == nil, "no Model on the sheet: each agent runs its own")
    #expect(desk.last("agent.models") == nil, "no model is read")
  }

  @Test("the bloom: its desktop and profile come chosen; a bud the profile holds no sign-in for is never chosen")
  func fromTheBloom() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField, docs], desktop: laptop, profileSet: "work"))
    #expect(model.selected == laptop)
    #expect(model.place == docs, "the newest place on the bloom's desktop")
    #expect(model.whereChoices == [.place(docs)], "from the field, the bloom's desktop's places alone")
    #expect(model.profileSet == "work")
    #expect(model.profileWords == "AS WORK")
    #expect(model.provider == "codex", "the first agent Work holds a sign-in for")
    let claude = try #require(model.agents.first { $0.id == "claude" })
    #expect(!model.runs(claude))
    model.chooseAgent("claude")
    #expect(model.provider == "codex", "a dashed bud is never chosen")
    model.chooseAgent("hermes")
    #expect(model.provider == "hermes")
    #expect(await model.spawn())
    let spawn = try #require(desk.last("agent.spawn"))
    #expect(spawn.device == laptop)
    #expect(spawn.params?["place"] == docs.ref.json)
    #expect(spawn.params?["profileSet"] == .string("work"))
    #expect(spawn.params?["provider"] == .string("hermes"))
  }

  @Test("no usual place: Browse's folder leads WHERE and launches by its path, beside which Browse opens again")
  func browse() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init())
    #expect(model.place == nil && model.needsFolder)
    #expect(!model.canSpawn)
    #expect(model.whereChoices.isEmpty)
    let reader = try #require(model.reader)
    let home = try #require(reader.roots.first { $0.browse == "home" })
    #expect(model.browseStart == LaunchModel.BrowseAt(root: home, path: ""), "nothing chosen: the home's top")
    await reader.open(home, path: "Projects/workbench")
    #expect(model.chooseCurrentFolder())
    let picked = try #require(model.picked)
    #expect(model.whereChoices == [.folder(picked)])
    #expect(model.chosen == .folder(picked))
    #expect(model.browseStart == LaunchModel.BrowseAt(root: home, path: "Projects"), "beside the chosen folder")
    #expect(await model.spawn())
    let spawn = try #require(desk.last("agent.spawn")?.params)
    #expect(spawn["cwd"] == (try workspaceFixture("workspace-list.valid"))["path"])
    #expect(spawn["place"] == nil)
  }

  @Test("a place chosen after Browse keeps Browse's folder at the head of WHERE, and either can be chosen again")
  func pickedStays() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField, older]))
    #expect(model.place == vibeField)
    let reader = try #require(model.reader)
    let home = try #require(reader.roots.first { $0.browse == "home" })
    #expect(model.browseStart == LaunchModel.BrowseAt(root: home, path: "Projects"), "beside the chosen place")
    await reader.open(home, path: "Projects/workbench")
    #expect(model.chooseCurrentFolder())
    let picked = try #require(model.picked)
    #expect(model.whereChoices == [.folder(picked), .place(vibeField), .place(older)])
    await model.choose(.place(older))
    #expect(model.place == older && model.folder == nil)
    #expect(model.whereChoices.first == .folder(picked), "Browse's folder stays")
    await model.choose(.folder(picked))
    #expect(model.folder == picked && model.place == nil)
  }

  @Test("the agent last started comes chosen next time, while the sheet's profile runs it")
  func lastStarted() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField], desktop: studio, profileSet: "native"))
    model.chooseAgent("grok")
    #expect(await model.spawn())
    await model.begin(.init(usual: [vibeField], desktop: studio, profileSet: "native"))
    #expect(model.provider == "grok")
    await model.begin(.init(usual: [vibeField], desktop: studio, profileSet: "work"))
    #expect(model.provider == "codex", "Work holds no sign-in for grok")
  }

  @Test("a project's place on another desktop brings its desktop; the profile and the agent stay when it has them")
  func anotherDesktop() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs]))
    model.chooseAgent("hermes")
    #expect(model.profileSet == "work")
    await model.choose(.place(docs))
    #expect(model.selected == laptop)
    #expect(model.place == docs)
    #expect(model.profileSet == "work")
    #expect(model.provider == "hermes", "the agent stays where that desktop offers it")
    #expect(
      model.whereChoices.map(\.id) == [docs, vibeField].map { LaunchWhere.place($0).id },
      "the sheet's desktop's places first")
    #expect(await model.spawn())
    #expect(desk.last("agent.spawn")?.device == laptop)
    // a place that cannot take a launch is never chosen
    await model.choose(.place(gone))
    #expect(model.place == docs)
  }

  @Test("a lost reply is said and never retried")
  func lostReply() async throws {
    let desk = Desk()
    desk.refused["agent.spawn"] = FieldProductError(
      kind: "TIMEOUT", message: "studio did not answer agent.spawn within 20 s", retryable: true)
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField]))
    #expect(await model.spawn() == false)
    #expect(model.message == "The desktop did not confirm the launch. Check the field before trying again.")
    #expect(desk.asked.filter { $0.method == "agent.spawn" }.count == 1)
  }

  // fix7 — PJ-7's first phone run: the first launch sheet stood blank for over
  // a minute (L8-blank-sheet.png: a large empty container, no title, no Cancel
  // — the sheet drew with no model; HomeScreen presents it by its model now).
  // Its parts must draw at once and say what they wait on, whatever answers.

  @Test("fix7: a folder read that does not answer holds nothing — the agents and profiles are read beside it", .timeLimit(.minutes(1)))
  func rootsHoldNoRow() async throws {
    let desk = Desk()
    desk.stalled = ["workspace.roots"]
    let model = desk.launch()
    let begun = Task { await model.begin(.init(usual: [vibeField])) }
    await settle("the agents and profiles read beside the roots") {
      desk.last("agent.catalog") != nil && model.profilesRead
    }
    #expect(model.agents.contains { $0.id == "claude" })
    #expect(model.whoWords == nil)
    #expect(model.canSpawn, "a place needs no folder roots to launch")
    // the roots answer from now on (a later read is not held again)
    desk.stalled = []
    desk.release()
    await begun.value
    #expect(model.reader?.roots.isEmpty == false, "the roots land when they answer")
  }

  @Test("fix7: WHO says it is reading; a refused catalog is said, never 'No agent available'", .timeLimit(.minutes(1)))
  func whoSaysIt() async throws {
    let desk = Desk()
    desk.stalled = ["agent.catalog"]
    let model = desk.launch()
    let begun = Task { await model.begin(.init(usual: [vibeField])) }
    await settle("the catalog asked") { desk.last("agent.catalog") != nil }
    #expect(model.whoWords == "Reading agents…")
    #expect(model.profileWords == "READING PROFILES…")
    desk.refused["agent.catalog"] = FieldProductError(
      kind: "TIMEOUT", message: "studio did not answer agent.catalog within 20 s", retryable: true)
    desk.stalled = []
    desk.release()
    await begun.value
    #expect(model.whoWords == "Agents could not be read")
    #expect(model.profileWords == nil)
    #expect(model.message == "studio did not answer agent.catalog within 20 s")
    #expect(!model.canSpawn)
  }

  @Test("a desktop asleep: WHO says so, and nothing starts")
  func asleep() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField]))
    model.update(model.desktops.map { .init(id: $0.id, name: $0.name, platform: $0.platform, online: false) })
    #expect(model.whoWords == "studio is asleep")
    #expect(!model.canSpawn)
    #expect(!model.canOpenShell)
  }

  // Item 587 — Terminal beside Start: a shell in the chosen folder under the sheet's profile, asked of the desktop
  // the place's ref names (terminal.create is local to its device and never federates).

  @Test("Terminal: a shell at the chosen place by its ref under the sheet's profile; no agent, no path")
  func shellAtAPlace() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs, older], recipe: try recipe()))
    #expect(model.canOpenShell)
    #expect(model.shellSentence == "Open a terminal in vibe-field")
    #expect(await model.openTerminal())
    let shell = try #require(desk.last("terminal.create"))
    #expect(shell.device == studio)
    #expect(shell.params == JSONValue.object(["place": vibeField.ref.json, "profileSet": .string("native")]))
    #expect(desk.last("agent.spawn") == nil, "Terminal starts no agent")
    #expect(model.lastProvider == nil, "nor counts as the agent last started")
  }

  @Test("Terminal at another desktop's place asks that desktop, the one its ref names")
  func shellOnThePlacesDesktop() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs, older], recipe: try recipe()))
    await model.choose(docs)
    #expect(model.selected == laptop)
    #expect(await model.openTerminal())
    let shell = try #require(desk.last("terminal.create"))
    #expect(shell.device == laptop)
    #expect(shell.params?["place"] == docs.ref.json)
    let asked = desk.asked.filter { $0.method == "terminal.create" }.map { $0.device }
    #expect(asked == [laptop], "one ask, never studio's")
  }

  @Test("Terminal from Browse's folder sends its path under the sheet's profile, never a place")
  func shellFromBrowse() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init())
    #expect(!model.canOpenShell, "no folder yet")
    let reader = try #require(model.reader)
    let home = try #require(reader.roots.first { $0.browse == "home" })
    await reader.open(home, path: "Projects/workbench")
    #expect(model.chooseCurrentFolder())
    let profile = try #require(model.profileSet)
    #expect(await model.openTerminal())
    let shell = try #require(desk.last("terminal.create")?.params)
    #expect(shell["cwd"] == (try workspaceFixture("workspace-list.valid"))["path"])
    #expect(shell["place"] == nil)
    #expect(shell["profileSet"] == .string(profile))
  }

  @Test("Terminal never asks without the sheet's profile; unreadable profiles leave Start alone", .timeLimit(.minutes(1)))
  func shellWaitsForTheProfile() async throws {
    let desk = Desk()
    desk.stalled = ["agents.profileSets.list"]
    let model = desk.launch()
    let begun = Task { await model.begin(.init(usual: [vibeField])) }
    await settle("the agents read before the profiles") { model.agentsRead }
    #expect(!model.canOpenShell)
    #expect(await model.openTerminal() == false)
    #expect(desk.last("terminal.create") == nil)
    desk.release()
    await begun.value
    #expect(model.canOpenShell)

    let unread = Desk()
    unread.refused["agents.profileSets.list"] = FieldProductError(kind: "UNAVAILABLE", message: "profiles unread")
    let fallback = unread.launch()
    await fallback.begin(.init(usual: [vibeField]))
    #expect(fallback.canSpawn, "the desktop's default starts the agent")
    #expect(!fallback.canOpenShell, "a shell never goes without its profile")
  }

  @Test("a refused shell is said in the sheet's words; one tap, one ask, a lost reply never asked again")
  func shellRefused() async throws {
    let desk = Desk()
    desk.refused["terminal.create"] = FieldProductError(
      kind: "FORBIDDEN_SCOPE", message: "opening a terminal under a profile requires agent.spawn",
      details: .object(["required": .string("agent.spawn")]))
    let model = desk.launch()
    await model.begin(.init(usual: [vibeField]))
    #expect(await model.openTerminal() == false)
    #expect(model.message == "studio needs an update before this phone can open a terminal there.")
    desk.refused["terminal.create"] = FieldProductError(
      kind: "TIMEOUT", message: "studio did not answer terminal.create within 20 s", retryable: true)
    #expect(await model.openTerminal() == false)
    #expect(model.message == "The desktop did not confirm the launch. Check the field before trying again.")
    #expect(desk.asked.filter { $0.method == "terminal.create" }.count == 2, "one ask per tap")
    #expect(!model.opening && model.canOpenShell)
  }

  @Test("one ask at a time: while either button asks, the other is off (§7) and the choices hold", .timeLimit(.minutes(1)))
  func oneAskAtATime() async throws {
    let desk = Desk()
    desk.stalled = ["terminal.create"]
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs, older], recipe: try recipe()))
    let opening = Task { await model.openTerminal() }
    await settle("Terminal asking") { model.opening }
    #expect(model.busy)
    #expect(!model.canSpawn, "Start is off while Terminal opens")
    #expect(await model.spawn() == false)
    await model.choose(older)
    #expect(model.place == vibeField, "the choice holds")
    desk.release()
    #expect(await opening.value)
    #expect(!model.busy && model.canSpawn)
    #expect(desk.last("agent.spawn") == nil)

    desk.stalled = ["agent.spawn"]
    let starting = Task { await model.spawn() }
    await settle("Start asking") { model.spawning }
    #expect(!model.canOpenShell, "Terminal is off while Start starts")
    #expect(await model.openTerminal() == false)
    desk.release()
    #expect(await starting.value)
    #expect(desk.asked.filter { $0.method == "terminal.create" }.count == 1)
  }
}
