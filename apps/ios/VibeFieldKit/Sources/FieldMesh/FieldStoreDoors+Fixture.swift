#if DEBUG
  import FieldProduct
  import Foundation

  extension FieldStoreDoors {
    /// A store that has already been told one thing.
    ///
    /// This is a FIXTURE STORE and not a demo path: `FieldLink` runs its real
    /// reconcile over these doors and the real reader parses the real bytes.
    /// What is fake is the MESH — one peer per slice, one message, never a
    /// second. It cannot exist in Release. A `full` is the message a node sends
    /// to a peer that just joined, which is exactly what this phone would have
    /// received.
    public static func fixture(
      slice: Data, deviceId: String = "dev-fixture", storeId: String
    ) -> FieldStoreDoors {
      fixture(slices: [storeId: [deviceId: slice]])
    }

    /// The general shape: a store id → the device ids publishing into it → the
    /// bytes each one published. One `full` per slice, delivered the moment
    /// the reader listens, which is what a node sends a peer that just joined.
    ///
    /// Each slice is delivered as if by ITS OWN device — the sender's id and
    /// its addresses match what the payload claims — so the attribution
    /// refusal sees exactly what a well-behaved mesh looks like. A fixture that
    /// could not pass its own checks would be testing a different program.
    public static func fixture(slices: [String: [String: Data]]) -> FieldStoreDoors {
      var byNamespace: [String: [FieldStoreInbound]] = [:]
      var peers: [FieldStorePeer] = []
      for (storeId, devices) in slices {
        let namespace = FieldStore.namespace(for: storeId)
        for (deviceId, bytes) in devices {
          let payload = JSONValue.object([
            "type": .string("full"),
            "device_id": .string(deviceId),
            "data": (try? JSONValue.parse(bytes)) ?? .null,
            "version": .int(1),
            "updated_at": .int(Int64(Date().timeIntervalSince1970 * 1000)),
          ])
          byNamespace[namespace, default: []].append(
            FieldStoreInbound(
              fromPeerId: "node-\(deviceId)", fromDeviceId: deviceId, msgType: "full",
              payload: (try? payload.encoded()) ?? Data(),
              fromAddresses: [fixtureHost(deviceId)]))
          if !peers.contains(where: { $0.deviceId == deviceId }) {
            peers.append(
              FieldStorePeer(
                id: "node-\(deviceId)", deviceId: deviceId, online: true,
                hostname: fixtureHost(deviceId), tailnetIPs: []))
          }
        }
      }
      return fixture(peers: peers, inbox: byNamespace)
    }

    /// A mesh of `peers` and nothing else: the peer list, and a bus that
    /// carries only what `inbox` says it already carried.
    static func fixture(
      peers: [FieldStorePeer], inbox: [String: [FieldStoreInbound]] = [:]
    ) -> FieldStoreDoors {
      FieldStoreDoors(
        onlinePeers: { peers.filter(\.online) },
        // The reader asks; nothing is listening, and that is honest — the
        // answer was already delivered below.
        send: { _, _, _, _ in },
        messages: { asked in
          AsyncStream { continuation in
            for inbound in inbox[asked] ?? [] { continuation.yield(inbound) }
            // Never finished: a finished stream would end the reader's loop,
            // and a paused-then-resumed link would find nothing listening.
          }
        },
        peerEvents: { AsyncStream { _ in } })
    }

    /// A fixture device's hostname, which is also what its published door must
    /// name for the endpoint pin to accept it.
    static func fixtureHost(_ deviceId: String) -> String { "127.0.0.1" }
  }

  extension FieldLink {
    /// `-vf-demo-field-slice` (PG-3e): PG-3a's WITNESS remote board through the
    /// REAL home path.
    ///
    /// The link discovers the peers, probes their doors, homes to the first
    /// that answers, dials it, says hello, and reads the field through the
    /// home's `agent.subscribe {projection: "remote", scope: "mesh"}` — every
    /// step the live phone takes. What is fake is the NETWORK: an in-process
    /// door that answers the witness's own bytes
    /// (`agent-remote-mesh-open.witness.json`, byte for byte under
    /// `Fixtures/`), so the swarm and the corner can be photographed over
    /// real-shaped rows in both themes with no desktop and no tailnet. The
    /// witness lists three desktops: the home (`Studio`, live, seven rows),
    /// `Loft` (live, its door not answering this phone — its three rows arrive
    /// through the home, wearing their host) and `Attic` (asleep, offline on
    /// the tailnet — its kept row draws GREYED, and the corner does not list
    /// it). The home is `dev-01HQ9S7UD1`, the board's first desktop and the
    /// first id in device order, so the copy's `here` and the link's home are
    /// one desktop.
    ///
    /// (Corrected 2026-11-02, PG-3e: from DS-8 this served the contracts'
    /// golden FIELD mesh board, `agent-mesh-open.valid.json`, over four
    /// desktops — studio, laptop, air, mini — through `{projection: "field"}`;
    /// before DS-8 it mounted the golden `field.agents.v1` slice through the
    /// store reader, retired by DS-D14.)
    public static func goldenFixture(
      schedule: FieldDiscoverySchedule = .init()
    ) -> FieldLink? {
      guard
        let url = Bundle.module.url(
          forResource: "agent-remote-mesh-open.witness", withExtension: "json",
          subdirectory: "Fixtures"),
        let data = try? Data(contentsOf: url),
        let open = try? JSONValue.parse(data)
      else { return nil }
      let peers = FixtureHome.desktops.map { desktop in
        FieldStorePeer(
          id: "node-\(desktop.deviceId)", deviceId: desktop.deviceId, online: desktop.online,
          hostname: desktop.name, tailnetIPs: [desktop.address])
      }
      return FieldLink(
        storeDoors: .fixture(peers: peers),
        transport: FixtureHome(open: open),
        probe: FixtureHome.Probe(),
        options: .init(maxBackoff: .seconds(2), callTimeout: .seconds(5)),
        schedule: schedule)
    }
  }

  /// The fixture's in-process door: every desktop's door answers the same way
  /// — hello as a self desktop, the witness's roster, and the witness's remote
  /// board — because only the HOME is ever dialled for the field. Nothing else
  /// is answered (NOT_FOUND), so an act on the fixture fails honestly rather
  /// than pretending a desktop did something.
  struct FixtureHome: ProductTransport {
    struct Desktop: Sendable {
      let deviceId: String
      let name: String
      let address: String
      let online: Bool
      let answers: Bool
    }

    /// The witness's three desktops, as the fixture's tailnet lists them (PG-3e: the golden field board's four
    /// until the switch).
    static let desktops = [
      Desktop(
        deviceId: "dev-01HQ9S7UD1", name: "Studio", address: "100.64.0.11", online: true,
        answers: true),
      Desktop(
        deviceId: "dev-01HQ9S7XZ2", name: "Loft", address: "100.64.0.12", online: true,
        answers: false),
      Desktop(
        deviceId: "dev-01HQ9S7Y44", name: "Attic", address: "100.64.0.13", online: false,
        answers: false),
    ]

    let open: JSONValue

    func connect(to url: URL) async throws -> any ProductConnection {
      FixtureConnection(open: open)
    }

    /// The door's HTTP half: the desktops that answer, answer; the rest are
    /// "not serving".
    struct Probe: ProductDoorProbe {
      func probe(_ url: URL) async -> DoorProbeOutcome {
        let answering = FixtureHome.desktops.contains { $0.answers && $0.address == url.host }
        return answering ? .status(400) : .unreachable("the fixture door is closed")
      }
    }
  }

  actor FixtureConnection: ProductConnection {
    private let open: JSONValue
    private var queue: [String] = []
    private var waiter: CheckedContinuation<String, any Error>?
    private var closed = false

    init(open: JSONValue) { self.open = open }

    func send(_ text: String) async throws {
      guard !closed else { throw FieldProductError(kind: "UNAVAILABLE", message: "closed") }
      guard let request = try? JSONValue.parse(Data(text.utf8)),
        let id = request["id"]?.intValue, let method = request["method"]?.stringValue
      else { return }
      deliver(answer(id: id, method: method))
    }

    func receive() async throws -> String {
      if !queue.isEmpty { return queue.removeFirst() }
      if closed { throw FieldProductError(kind: "UNAVAILABLE", message: "closed") }
      return try await withCheckedThrowingContinuation { waiter = $0 }
    }

    func close() {
      closed = true
      if let waiter {
        self.waiter = nil
        waiter.resume(throwing: FieldProductError(kind: "UNAVAILABLE", message: "closed"))
      }
    }

    private func answer(id: Int64, method: String) -> String {
      switch method {
      case "system.hello":
        return Self.frame(
          id: id,
          result: .object([
            "contractsVersion": .string(FieldProductContract.contractsVersion),
            "serverKind": .string("fieldd"),
            "grantedScopes": .array([.string("agent.observe"), .string("terminal.attach")]),
          ]))
      case "device.list":
        let home = FixtureHome.desktops[0].deviceId
        return Self.frame(
          id: id,
          result: .object([
            "devices": .array(
              FixtureHome.desktops.map { desktop in
                .object([
                  "deviceId": .string(desktop.deviceId), "name": .string(desktop.name),
                  "platform": .string("darwin"), "self": .bool(desktop.deviceId == home),
                  "online": .bool(desktop.online),
                ])
              })
          ]))
      case "agent.subscribe":
        return Self.frame(id: id, result: .object(["subId": .string("fixture"), "snapshot": open]))
      default:
        let error = JSONValue.object([
          "jsonrpc": .string("2.0"), "id": .int(id),
          "error": .object([
            "code": .int(-32601),
            "message": .string("the fixture door does not answer \(method)"),
            "data": .object(["kind": .string("NOT_FOUND"), "retryable": .bool(false)]),
          ]),
        ])
        return String(data: (try? error.encoded()) ?? Data(), encoding: .utf8) ?? ""
      }
    }

    private static func frame(id: Int64, result: JSONValue) -> String {
      let value = JSONValue.object([
        "jsonrpc": .string("2.0"), "id": .int(id), "result": result,
      ])
      return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
    }

    private func deliver(_ text: String) {
      if let waiter {
        self.waiter = nil
        waiter.resume(returning: text)
      } else {
        queue.append(text)
      }
    }
  }
#endif
