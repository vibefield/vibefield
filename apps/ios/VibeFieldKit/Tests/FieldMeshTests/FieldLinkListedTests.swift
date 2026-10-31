import Foundation
import Testing

@testable import FieldMesh

/// TS-7 — the phone's "No desktops yet" is an ANSWER, never the blank before
/// one: a link says it has listed only after a sweep read the online peers and
/// every one of them had finished its hello.
@MainActor
@Suite("a link has listed only once a sweep has answered")
struct FieldLinkListedTests {
  @Test func aTailnetWithNoPeersIsListedAndEmpty() async throws {
    let (link, _, _, _) = try await standingLink(peers: [])
    defer { link.stop() }
    try await waitUntil("the first sweep to answer") { link.hasListed }
    #expect(link.desktops.isEmpty)
  }

  @Test func aPeerStillInItsHelloKeepsTheListingOpen() async throws {
    let early = FieldStorePeer(
      id: "node-early", deviceId: nil, online: true, hostname: "early", tailnetIPs: ["100.64.0.7"])
    let counter = SweepCounter()
    let (link, mesh, _, _) = try await standingLink(peers: [early], counter: counter)
    defer { link.stop() }
    try await waitUntil("a second sweep to begin") { await counter.count >= 2 }
    #expect(!link.hasListed)

    let filed = FieldStorePeer(
      id: "node-early", deviceId: "dev-early", online: true, hostname: "early", tailnetIPs: ["100.64.0.7"])
    await mesh.set(peers: [filed])
    try await sweepNow(mesh, counter, peer: filed)
    try await waitUntil("the listing to answer") { link.hasListed }
    #expect(link.desktops.contains { $0.deviceId == "dev-early" })
  }

  @Test func aStoppedLinkHasListedNothing() async throws {
    let (link, _, _, _) = try await standingLink(peers: [])
    try await waitUntil("the first sweep to answer") { link.hasListed }
    link.stop()
    #expect(!link.hasListed)
  }
}
