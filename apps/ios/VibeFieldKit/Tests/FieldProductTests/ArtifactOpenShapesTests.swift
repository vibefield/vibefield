import Foundation
import Testing

@testable import FieldProduct

/// SP-4 / MA-5 — `artifact.open` as the phone asks it and reads it, against the contracts' own bytes
/// (`pnpm check:ios-fixtures`).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("SP-4 / MA-5 — artifact.open, as the phone asks and reads it")
struct ArtifactOpenShapesTests {
  @Test("serving: the root URL its listener reported, and the page's declared hosts")
  func serving() throws {
    let json = try Fixture.json("artifact-open.serving")
    let answer = try ArtifactOpenResult(json: json)
    #expect(answer.state == .serving)
    #expect(answer.url == "https://studio.tail1234.ts.net:13377")
    #expect(answer.reach == ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"])
    #expect(answer.unknownFields.isEmpty)
  }

  @Test("starting: no URL until its listener reports one, and no hosts")
  func starting() throws {
    let json = try Fixture.json("artifact-open.starting")
    let answer = try ArtifactOpenResult(json: json)
    #expect(answer.state == .starting)
    #expect(answer.url == nil)
    #expect(answer.reach == nil)
    #expect(answer.unknownFields.isEmpty)
  }

  @Test("a state this build cannot read is starting, which promises nothing is up")
  func unheardState() throws {
    let answer = try ArtifactOpenResult(json: .object(["state": .string("warming")]))
    #expect(answer.state == .starting)
  }

  @Test("a URL that is not a root claim is stripped, never rewritten; the state stands")
  func notAClaim() throws {
    for raw in [
      "https://studio.tail1234.ts.net:13377/index.html", "http://studio.tail1234.ts.net:13377",
      "https://studio.tail1234.ts.net", "https://studio.tail1234.ts.net:13377/?t=1",
    ] {
      let answer = try ArtifactOpenResult(json: .object(["state": .string("serving"), "url": .string(raw)]))
      #expect(answer.url == nil, "\(raw)")
      #expect(answer.state == .serving)
    }
  }

  @Test("one host that is not a bare public DNS host voids the whole list, as the contract's catch does")
  func badReach() throws {
    let bad: [[JSONValue]] = [
      [.string("cdn.jsdelivr.net"), .string("studio.tail1234.ts.net")],
      [.string("1.2.3.4")],
      [.string("ts.net")],
      [.string("CDN.jsdelivr.net")],
      [.string("localhost")],
      [.string("cdn.jsdelivr.net"), .int(1)],
      (0...MadeAppReach.maxHosts).map { JSONValue.string("h\($0).example.com") },
    ]
    for hosts in bad {
      let answer = try ArtifactOpenResult(json: .object(["state": .string("serving"), "reach": .array(hosts)]))
      #expect(answer.reach == nil, "\(hosts)")
    }
    let full = (1...MadeAppReach.maxHosts).map { JSONValue.string("h\($0).example.com") }
    let answer = try ArtifactOpenResult(json: .object(["state": .string("serving"), "reach": .array(full)]))
    #expect(answer.reach?.count == MadeAppReach.maxHosts)
  }

  @Test("the phone's ask: the app's id and its desktop, the contracts' own bytes, and never `reveal`")
  func params() throws {
    let fixture = try Fixture.json("artifact-open-params.valid")
    var fields = try #require(fixture.objectValue)
    fields["//"] = nil
    let appId = try #require(fields["appId"]?.stringValue)
    let device = try #require(fields["device"]?.stringValue)
    let asked = ArtifactOpenParams(appId: appId, device: device).json
    #expect(asked == .object(fields))
    let home = ArtifactOpenParams(appId: appId, device: nil).json
    #expect(home == .object(["appId": .string(appId)]))
    #expect(asked["reveal"] == nil)
  }
}
