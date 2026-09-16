import Foundation
import Testing

@testable import FieldMesh

// EL7 M1 — a published dial target is somebody else's string until the mesh
// vouches for it.

private let studioAddresses = ["studio", "100.64.0.2"]

@Suite struct ProductEndpointCheckTests {
  @Test func theDesktopsOwnDoorIsAccepted() {
    for host in ["studio", "studio.tail.ts.net", "100.64.0.2"] {
      let verdict = verifyProductEndpoint(
        "http://\(host):443/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM",
        from: studioAddresses, magicDNSSuffix: "tail.ts.net")
      #expect(verdict.url != nil, "\(host) is this desktop")
    }
  }

  /// THE attack: a peer publishes a slice naming a door on a machine it
  /// controls, and the phone dials it carrying its WhoIs-granted `self` scopes.
  @Test func aDoorSomewhereElseIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://attacker.example/t/secret", from: studioAddresses, magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
    #expect(verdict.reason == "the published door points somewhere this desktop is not")
  }

  /// The reason the match is an EQUALITY and not a prefix: MagicDNS forwards
  /// names it does not own to the upstream resolver, so `studio.attacker.example`
  /// resolves — and a `hasPrefix("studio.")` would have welcomed it.
  @Test func aNameThatMerelyStartsWithTheSlugIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://studio.attacker.example/t/secret", from: studioAddresses,
      magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
  }

  /// Without the tailnet's own suffix the FQDN cannot be built, so only the
  /// bare forms are vouched for. Refusing is the honest answer: the phone has
  /// nothing to check the name against.
  @Test func withoutTheSuffixOnlyTheBareAddressesAreVouchedFor() {
    #expect(verifyProductEndpoint("ws://studio/t/x", from: studioAddresses).url != nil)
    #expect(
      verifyProductEndpoint("ws://studio.tail.ts.net/t/x", from: studioAddresses).url == nil)
  }

  @Test func aSchemeThatIsNotASocketIsRefused() {
    for raw in ["file:///etc/passwd", "vibefield://studio/t/x", "javascript:alert(1)"] {
      let verdict = verifyProductEndpoint(
        raw, from: studioAddresses, magicDNSSuffix: "tail.ts.net")
      #expect(verdict.url == nil, "\(raw) is not a socket")
    }
  }

  /// C3 — the door IS the secret path. A URL on the right machine that is not
  /// one is not this door.
  @Test func aUrlThatIsNotACapabilityPathIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://studio/admin", from: studioAddresses, magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
    #expect(verdict.reason == "the published door is not a capability path")
  }

  /// A desktop the mesh can say nothing about cannot be dialed. Silence is not
  /// permission.
  @Test func aDesktopWithNoVouchedAddressIsRefused() {
    let verdict = verifyProductEndpoint("ws://studio/t/x", from: [])
    #expect(verdict.url == nil)
    #expect(verdict.reason == "this desktop has no address the mesh will vouch for")
  }

  @Test func anAbsentOrUnparseableDoorIsAStateAndNotAnAlarm() {
    #expect(verifyProductEndpoint(nil, from: studioAddresses).reason?.contains("not serving") == true)
    #expect(verifyProductEndpoint("", from: studioAddresses).url == nil)
    #expect(verifyProductEndpoint("not a url at all", from: studioAddresses).url == nil)
  }

  /// The golden's own spelling parses: the contracts publish `http://…:443/t/…`
  /// (fieldd builds it from truffle's serve URL), which is why this check does
  /// not pin `wss` the way the review asked.
  @Test func theContractsOwnSpellingIsAccepted() {
    let verdict = verifyProductEndpoint(
      "http://mac.tail1234.ts.net:443/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM",
      from: ["mac"], magicDNSSuffix: "tail1234.ts.net")
    #expect(verdict.url != nil)
  }
}

// MARK: - UA-P-1a: the door the PHONE builds

/// Discovery by the door inverts where the dial target comes from: the phone
/// composes it from the peer's own MagicDNS name and the registry port, so a
/// peer cannot name a machine it is not. What the pin still asserts is that
/// what was composed IS an address the mesh vouches for — and it is the line
/// that would catch the composition ever learning a host from somewhere else.
@Suite struct PeerDoorBuilderTests {
  @Test func theDoorIsThePeersOwnFullyQualifiedNameAndTheRegistryPort() throws {
    let verdict = peerProductDoorURL(
      hostname: "studio", tailnetIPs: ["100.64.0.2"], magicDNSSuffix: "tail.ts.net")
    let url = try #require(verdict.url)
    #expect(url.scheme == "ws")
    #expect(url.host == "studio.tail.ts.net")
    #expect(url.port == FieldMeshContract.productServePort)
    #expect(url.path == "/")
  }

  /// NO SECRET. The C3 capability path is the sidecar's to add on forward, and
  /// the whole point of UA-P-1a is that the phone never learns one: a locator
  /// that carried a secret would be a credential this phone read off a wire.
  @Test func theBuiltDoorCarriesNoCapabilityPath() throws {
    let url = try #require(
      peerProductDoorURL(
        hostname: "studio", tailnetIPs: [], magicDNSSuffix: "tail.ts.net").url)
    #expect(!url.absoluteString.contains("/t/"))
  }

  /// A peer whose hostname is ALREADY fully qualified is not qualified twice.
  @Test func anAlreadyQualifiedNameIsNotDoubled() throws {
    let url = try #require(
      peerProductDoorURL(
        hostname: "studio.tail.ts.net", tailnetIPs: [], magicDNSSuffix: "tail.ts.net").url)
    #expect(url.host == "studio.tail.ts.net")
  }

  /// With no suffix of our own the slug is not qualified at all, and a tailnet
  /// IP is preferred: a phone with no tailnet domain is a phone whose resolver
  /// may answer a short name from the public DNS.
  @Test func anAddressIsPreferredWhenThereIsNoSuffix() throws {
    let url = try #require(
      peerProductDoorURL(
        hostname: "studio", tailnetIPs: ["100.64.0.2"], magicDNSSuffix: nil).url)
    #expect(url.host == "100.64.0.2")
  }

  /// And a peer the mesh says nothing about has nowhere to dial. Silence is
  /// not permission, and it is a sentence rather than a silent absence.
  @Test func aPeerWithNoAddressAtAllIsRefused() {
    let verdict = peerProductDoorURL(hostname: nil, tailnetIPs: [], magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
    #expect(verdict.reason == "this desktop has no address the mesh will vouch for")
    #expect(peerProductDoorURL(hostname: "", tailnetIPs: [], magicDNSSuffix: nil).url == nil)
  }
}

/// The two halves of the account check, as rules — no clock, no socket, no peer.
@Suite struct DoorPolicyTests {
  /// The sidecar's own answer, and the one the ruling is about.
  @Test func aForbiddenDoorIsNotThisAccounts() {
    #expect(
      DoorPolicy.admission(for: .status(403))
        == .notThisAccount("the door refused this login (403)"))
    // 401 joins it: a door that asks this phone for a credential is a door it
    // cannot open, because it presents none by design (C5).
    #expect(DoorPolicy.admission(for: .status(401)) != .answering)
  }

  /// EVERY other status is an answer, including the ones a WebSocket endpoint
  /// gives a plain GET. Reading 400 or 426 as a refusal would turn the phone's
  /// own probe into the reason it never dials.
  @Test func aWebSocketEndpointsAnswerToAPlainGetIsStillAnAnswer() {
    for status in [200, 400, 404, 426, 500] {
      #expect(DoorPolicy.admission(for: .status(status)) == .answering, "\(status)")
    }
  }

  @Test func silenceIsUnreachableAndNeverARefusal() {
    #expect(
      DoorPolicy.admission(for: .unreachable("connection refused"))
        == .unreachable("connection refused"))
  }

  /// fieldd's `tailnet-guest`: the hello succeeds and grants nothing.
  @Test func anEmptyGrantIsNotThisAccountEither() {
    #expect(
      DoorPolicy.admission(forGrantedScopes: [])
        == .notThisAccount("the door granted nothing — this is another account's desktop"))
    #expect(DoorPolicy.admission(forGrantedScopes: ["agent.read"]) == .answering)
  }
}
