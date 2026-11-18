import FieldMesh
import FieldProduct
import FieldWeb
import Foundation
import Testing

@testable import FieldHome

/// MA-5b-1 — the open app's screen: the face it draws for each phase, a page that falls back to the honest screen in
/// its words, the one page made again, and its way out: the front's dials over the mesh node (item 522).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-5b-1 — the open app")
struct AppsOpenScreenTests {
  typealias Fixtures = AppOpenModelTests

  static let row = AppsHonest(title: "studio is asleep", detail: nil, act: nil)

  static func policy() throws -> WebNavigationPolicy {
    let origin = try #require(WebOrigin(claim: Fixtures.root))
    return WebNavigationPolicy(origin: origin, reach: ["unpkg.com"])
  }

  private func model() -> AppOpenModel {
    let model = AppOpenModel()
    model.sleep = { _ in }
    model.opensApps = true
    return model
  }

  @Test("a build that opens no app keeps the row's honest screen, whatever the phase")
  func shut() throws {
    let url = try #require(URL(string: Fixtures.root))
    let phases: [AppOpenModel.Phase] = [
      .idle, .opening(appKey: "a", desktop: "studio", late: true),
      .serving(appKey: "a", url: url, policy: try Self.policy()),
    ]
    for phase in phases {
      let face = AppsOpenFace.of(phase, appKey: "a", row: Self.row, opens: false)
      #expect(face == .honest(Self.row))
    }
  }

  @Test("asked: the icon alone, then the words once late, the page while it serves, and a refusal in its words")
  func faces() throws {
    let url = try #require(URL(string: Fixtures.root))
    let policy = try Self.policy()
    let refused = AppsHonest(title: "Can't reach studio", detail: "It isn't answering.", act: nil)
    let cases: [(AppOpenModel.Phase, AppsOpenFace)] = [
      (.idle, .icon),
      (.opening(appKey: "a", desktop: "studio", late: false), .icon),
      (.opening(appKey: "a", desktop: "studio", late: true), .opening("Opening on studio…")),
      (.serving(appKey: "a", url: url, policy: policy), .page(url: url, policy: policy)),
      (.refused(appKey: "a", honest: refused), .honest(refused)),
    ]
    for (phase, want) in cases {
      let face = AppsOpenFace.of(phase, appKey: "a", row: Self.row, opens: true)
      #expect(face == want)
    }
  }

  @Test("another app's phase is never drawn: the icon stands")
  func otherApp() throws {
    let url = try #require(URL(string: Fixtures.root))
    let phases: [AppOpenModel.Phase] = [
      .opening(appKey: "b", desktop: "studio", late: true),
      .serving(appKey: "b", url: url, policy: try Self.policy()),
      .refused(appKey: "b", honest: Self.row),
    ]
    for phase in phases {
      let face = AppsOpenFace.of(phase, appKey: "a", row: Self.row, opens: true)
      #expect(face == .icon)
    }
  }

  @Test("a failed load makes the page and its front once more; the second falls")
  func retry() {
    var retry = AppsPageRetry()
    let first = retry.failed()
    let second = retry.failed()
    let third = retry.failed()
    #expect(first)
    #expect(!second)
    #expect(!third)
  }

  @Test("each fall in its words: the desktop out of reach, or an app that cannot run here")
  func fallWords() {
    let cases: [(AppsPageFall, String, String?)] = [
      (.noProxy, "Can't reach studio", "It isn't answering."),
      (.unreachable, "Can't reach studio", "It isn't answering."),
      (.ended, "Can't reach studio", "It isn't answering."),
      (.ruleList, AppsHonest.cannotRunYet, nil),
    ]
    for (fall, title, detail) in cases {
      let why = fall.why(desktop: "studio")
      #expect(why.title == title)
      #expect(why.detail == detail)
    }
  }

  @Test("a serving page that falls says why, and the next open asks the desktop again")
  func pageFell() async throws {
    let door = Fixtures.Door()
    door.answers = [.success(Fixtures.serving()), .success(Fixtures.serving())]
    let model = model()
    let app = try Fixtures.row("a", hosted: "https://claude.ai/code/artifact/review")
    let sources = [try Fixtures.source()]
    await model.open(app, sources: sources, here: "this desktop", door: door)
    model.pageFell(app, .unreachable, desktop: "studio")
    let phase = model.phase
    guard case .refused(let key, let honest) = phase else { Issue.record("not refused: \(phase)"); return }
    #expect(key == "a")
    #expect(honest.title == "Can't reach studio")
    #expect(honest.act?.word == "Open in claude.ai")
    await model.open(app, sources: sources, here: "this desktop", door: door)
    let again = model.phase
    guard case .serving = again else { Issue.record("not serving: \(again)"); return }
    #expect(door.asked.count == 2)
  }

  @Test("a fall for an app that is not serving changes nothing")
  func fallElsewhere() async throws {
    let door = Fixtures.Door()
    door.answers = [.success(Fixtures.serving())]
    let model = model()
    let app = try Fixtures.row("a")
    await model.open(app, sources: [try Fixtures.source()], here: "this desktop", door: door)
    model.pageFell(try Fixtures.row("b"), .ended, desktop: "studio")
    let phase = model.phase
    guard case .serving(let key, _, _) = phase else { Issue.record("not serving: \(phase)"); return }
    #expect(key == "a")
    model.left()
    model.pageFell(app, .ended, desktop: "studio")
    let left = model.phase
    #expect(left == .idle)
  }

  #if DEBUG || VF_WEB_RELAY
    @Test("the way out is the front's dials over the mesh node; a mesh with no runtime gives none, so no page")
    func noRuntimeNoDials() async throws {
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("vf-ma5b1-\(UUID().uuidString)", isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      let mesh = MeshModel(stateDirectory: directory)
      let dials = await AppsFrontDials.from(mesh)
      let none = dials == nil
      #expect(none)
    }
  #endif
}
