#if DEBUG || VF_WEB_RELAY
  import Testing

  @testable import FieldMesh

  /// Item 522 — which ONE peer an app's origin names, for the front's mesh dial: a peer's own DNS name, never one built
  /// from a hostname, never the first of two, and a peer with no DNS name is nobody's origin.
  ///
  /// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
  @Suite("522 — the origin's one peer")
  struct OriginPeerTests {
    @Test("two peers of one hostname: the origin is the one whose own DNS name it is, the -1 one included")
    func sameHostname() {
      let names: [String?] = ["studio.tail1234.ts.net.", "studio-1.tail1234.ts.net."]
      let first = MeshModel.originPeer("studio.tail1234.ts.net", among: names)
      let second = MeshModel.originPeer("studio-1.tail1234.ts.net", among: names)
      #expect(first == 0)
      #expect(second == 1)
    }

    @Test("a node shared in from another tailnet is not the origin of the same hostname here")
    func sharedIn() {
      let shared: [String?] = ["studio.other5678.ts.net."]
      let alone = MeshModel.originPeer("studio.tail1234.ts.net", among: shared)
      let beside = MeshModel.originPeer("studio.tail1234.ts.net", among: shared + ["studio.tail1234.ts.net."])
      #expect(alone == nil)
      #expect(beside == 1)
    }

    @Test("a peer with no DNS name is nobody's origin")
    func noDNSName() {
      let found = MeshModel.originPeer("studio.tail1234.ts.net", among: [nil, "", "."])
      #expect(found == nil)
    }

    @Test("two peers answering to one name are no answer")
    func twice() {
      let names: [String?] = ["studio.tail1234.ts.net.", "STUDIO.tail1234.ts.net"]
      let found = MeshModel.originPeer("studio.tail1234.ts.net", among: names)
      #expect(found == nil)
    }

    @Test("no peer, or none of that name: no answer; a trailing dot and case make no other name")
    func spelling() {
      let names: [String?] = ["Studio.Tail1234.ts.net."]
      let empty = MeshModel.originPeer("studio.tail1234.ts.net", among: [])
      let other = MeshModel.originPeer("laptop.tail1234.ts.net", among: names)
      let dotted = MeshModel.originPeer("STUDIO.tail1234.ts.net.", among: names)
      #expect(empty == nil)
      #expect(other == nil)
      #expect(dotted == 0)
    }
  }
#endif
