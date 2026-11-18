import FieldProduct
import FieldSettings
import Foundation
import Testing

@testable import FieldHome

/// Item 532 (asked for 2026-11-18) — no launch argument reaches a TestFlight build or the build App Review sees. A
/// launch argument is set by a developer's tooling, so outside a development build the kit reads none: every demo and
/// fixture read takes its arguments from `LaunchArguments.current`, which answers `[]` there.
///
/// The first row is a wall, not a count. It reads every line of the kit's Sources and the app's that a review or a
/// TestFlight build compiles, with an `#if` evaluator that refuses any condition it cannot evaluate, and holds that
/// none reads the process's arguments. A gate widened later stays held by it.
///
/// The wall's scan runs in a detached task and walks line by line only the files that hold an `#if` or spell a read.
/// Seen 2026-11-18: a cold FieldHomeTests-only run ends hundreds of rows together, with or without this row, and a
/// neighbour's two-second wait (`NewSparkCreateTests`) failed in two of four such runs. This row was not shown to be
/// the cause (item 538).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("no launch argument reaches a TestFlight build or the review build: the kit reads them in development alone")
struct LaunchArgumentsTests {
  /// The kit's folder, two steps up from this file (`Tests/FieldHomeTests/LaunchArgumentsTests.swift`).
  static let kit = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

  /// The kit's Sources and the app's own, beside the kit.
  static let roots = [
    kit.appendingPathComponent("Sources"), kit.deletingLastPathComponent().appendingPathComponent("App"),
  ]

  /// The flags each build that leaves a developer's hands is compiled with: the review build none, a TestFlight build
  /// `VF_TESTFLIGHT`. Neither sets DEBUG.
  static let builds: [(name: String, flags: Set<String>)] = [("review", []), ("TestFlight", ["VF_TESTFLIGHT"])]

  /// The flags a condition may name. A condition the kit compiles is a `||` of these; any other is refused.
  static let known: Set<String> = ["DEBUG", "VF_TESTFLIGHT", "VF_WEB_RELAY"]

  /// What reads the process's arguments.
  static func readsArguments(_ line: String) -> Bool {
    line.contains("ProcessInfo.processInfo.arguments") || line.contains("CommandLine.arguments")
      || line.contains("CommandLine.unsafeArgv")
  }

  /// A condition's value under `flags`, or nil when it is not a `||` of known flags.
  static func holds(_ condition: String, flags: Set<String>) -> Bool? {
    let bare = condition.components(separatedBy: "//")[0].trimmingCharacters(in: .whitespaces)
    let names = bare.components(separatedBy: "||").map { $0.trimmingCharacters(in: .whitespaces) }
    guard !bare.isEmpty, names.allSatisfy({ known.contains($0) }) else { return nil }
    return names.contains { flags.contains($0) }
  }

  /// The lines `flags` compiles in one file (numbered from 1, comment lines left out), and the conditions it could
  /// not evaluate.
  static func compiled(_ text: String, flags: Set<String>) -> (lines: [(Int, String)], unread: [String]) {
    var lines: [(Int, String)] = []
    var unread: [String] = []
    // Each open `#if`: whether its parent compiles, whether this branch does, and whether a branch was taken.
    var stack: [(parent: Bool, on: Bool, taken: Bool)] = []
    var on = true
    for (index, line) in text.components(separatedBy: "\n").enumerated() {
      let bare = line.drop { $0 == " " || $0 == "\t" }
      if bare.hasPrefix("#if ") {
        let condition = String(bare.dropFirst(4))
        let value = holds(condition, flags: flags)
        if value == nil { unread.append(condition) }
        stack.append((on, value ?? false, value ?? false))
        on = on && (value ?? false)
      } else if bare.hasPrefix("#elseif "), let top = stack.last {
        let condition = String(bare.dropFirst(8))
        let value = holds(condition, flags: flags)
        if value == nil { unread.append(condition) }
        let branch = !top.taken && (value ?? false)
        stack[stack.count - 1] = (top.parent, branch, top.taken || branch)
        on = top.parent && branch
      } else if bare == "#else" || bare.hasPrefix("#else "), let top = stack.last {
        stack[stack.count - 1] = (top.parent, !top.taken, true)
        on = top.parent && !top.taken
      } else if bare == "#endif" || bare.hasPrefix("#endif "), let top = stack.popLast() {
        on = top.parent
      } else if on, !bare.hasPrefix("//") {
        lines.append((index + 1, line))
      }
    }
    return (lines, unread)
  }

  /// A defaults domain of the row's own, and its removal when the row ends.
  private func store() throws -> (defaults: UserDefaults, done: () -> Void) {
    let name = "vibefield.tests.launch-arguments.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    return (defaults, { defaults.removePersistentDomain(forName: name) })
  }

  @Test("no line a review or a TestFlight build compiles reads the process's arguments, and every condition is read")
  func noReadOutsideDevelopment() async throws {
    let scan = try await Task.detached(priority: .utility) { try Self.scan() }.value
    let named = scan.reads.sorted()
    let unread = scan.unread.sorted()
    #expect(scan.files > 400)
    #expect(unread.isEmpty, "conditions the row cannot evaluate: \(unread)")
    #expect(named.isEmpty, "\(named.count) lines outside development read the process's arguments: \(named)")
  }

  /// What the wall finds: how many Swift files it read, the conditions it could not evaluate, and each line a review
  /// or a TestFlight build compiles that reads the process's arguments.
  struct Scan: Sendable {
    var files = 0
    var unread: Set<String> = []
    var reads: Set<String> = []
  }

  /// Every Swift file of the kit's Sources and the app's, read once. A file that holds no `#if` and spells no read
  /// cannot break the wall, so only the others are walked line by line, once for each build.
  static func scan() throws -> Scan {
    var scan = Scan()
    for root in roots {
      let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
      while let url = walker?.nextObject() as? URL {
        guard url.pathExtension == "swift" else { continue }
        scan.files += 1
        let text = try String(contentsOf: url, encoding: .utf8)
        guard text.contains("#if") || readsArguments(text) else { continue }
        for build in builds {
          let read = compiled(text, flags: build.flags)
          scan.unread.formUnion(read.unread)
          for (number, line) in read.lines where readsArguments(line) {
            scan.reads.insert("\(url.lastPathComponent):\(number) (\(build.name))")
          }
        }
      }
    }
    return scan
  }

  @Test("a TestFlight build's read of -vf-mock or -vf-demo-account stands no demo, and is no scripted run")
  func testFlightStandsNothing() throws {
    let (d, done) = try store()
    defer { done() }
    let mock = LaunchArguments.of(["-vf-mock"], development: false)
    let account = LaunchArguments.of(["-vf-demo-account=approval"], development: false)
    let field = LaunchFixtures.read(arguments: mock, defaults: d)
    let state = LaunchFixtures.read(arguments: account, defaults: d)
    let scripted = LaunchFixtures.fromArguments(mock) ?? LaunchFixtures.fromArguments(account)
    #expect(field == .off)
    #expect(state == .off)
    #expect(scripted == nil)
  }

  @Test("the Developer page's own Demo field still stands in a TestFlight build, as the page's choice, not a script")
  func pageStillStands() throws {
    let (d, done) = try store()
    defer { done() }
    d.set(true, forKey: DeveloperChoices.demoFieldKey)
    let arguments = LaunchArguments.of([], development: false)
    let read = LaunchFixtures.read(arguments: arguments, defaults: d)
    let scripted = LaunchFixtures.fromArguments(arguments)
    #expect(read == LaunchFixtures(demoField: true, account: nil))
    #expect(scripted == nil)
  }

  @Test("in a development build the arguments pass as they are")
  func developmentPasses() {
    let given = ["-vf-mock", "-vf-demo-account=approval"]
    let passed = LaunchArguments.of(given, development: true)
    let development = LaunchArguments.development
    let current = LaunchArguments.current
    let process = ProcessInfo.processInfo.arguments
    #expect(passed == given)
    #expect(development)
    #expect(current == process)
  }
}
