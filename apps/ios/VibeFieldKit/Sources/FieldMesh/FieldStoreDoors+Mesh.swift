import FieldProduct
import Foundation
import GhostteaTruffle
import Truffle

/// Why a send could not be made. A peer that has gone is not an incident — a
/// tailnet is a set of devices that come and go — so this carries no more than
/// which one, and the reader logs it as a note.
public enum FieldStoreError: Error, Equatable, CustomStringConvertible {
  case peerGone(String)

  public var description: String {
    switch self {
    case .peerGone(let id): "peer \(id) is no longer in reach"
    }
  }
}

extension FieldStoreDoors {
  /// The live doors, over the running node.
  ///
  /// Three upstream facts this wiring rests on, each verified against the
  /// pinned source rather than assumed:
  ///
  /// - the messaging door is `onMessage(namespace:handler:)`, NOT a
  ///   `subscribe(namespace:)` — §10.3 names the latter and no such method
  ///   exists on `MeshNode`.
  /// - the handle it returns is held WEAKLY by the node and cancels itself on
  ///   release, so the stream keeps it alive and cancels it when the stream
  ///   ends. A door that forgot this would go quiet on the next allocation.
  /// - peer arrival and departure ARE observable at this layer:
  ///   `MeshEvent.peerUpsert` / `.peerLeft` carry the whole `Peer`. Ghosttea's
  ///   own wrapper flattens both into one `peersChanged` with no payload —
  ///   which is why this reads `node.events` directly instead of the runtime's,
  ///   and why it needs no 2 s poll the way `RemoteSessionField` does.
  public static func live(node: MeshNode) -> FieldStoreDoors {
    FieldStoreDoors(
      onlinePeers: {
        await node.peers().filter(\.online).map(Self.peerView)
      },
      send: { peerId, namespace, msgType, payload in
        // Re-resolve every time rather than holding a `Peer`: upstream's sends
        // are generation-checked, and a value we cached across a leave-and-
        // rejoin would be refused as gone anyway. The lookup is a dictionary
        // read on an actor.
        guard let peer = await node.peers().first(where: { $0.tailscaleId == peerId }) else {
          throw FieldStoreError.peerGone(peerId)
        }
        try await node.sendJSON(
          to: peer, namespace: namespace, msgType: msgType, payload: payload)
      },
      messages: { namespace in
        let (stream, continuation) = AsyncStream.makeStream(
          of: FieldStoreInbound.self, bufferingPolicy: .bufferingNewest(256))
        let subscription = await node.onMessage(namespace: namespace) { message in
          continuation.yield(
            FieldStoreInbound(
              // `message.from` is attributed from the connection's
              // hello-authenticated identity, never from the wire's own `from`
              // field — upstream says so at the declaration, and it is what
              // makes the reader's attribution check worth anything.
              fromPeerId: message.from.tailscaleId,
              fromDeviceId: message.from.deviceId,
              msgType: message.msgType,
              payload: message.payloadJSON))
        }
        continuation.onTermination = { _ in
          Task { await subscription.cancel() }
        }
        return stream
      },
      peerEvents: {
        let upstream = await node.events
        return AsyncStream(bufferingPolicy: .bufferingNewest(128)) { continuation in
          let task = Task {
            for await event in upstream {
              switch event {
              case .peerUpsert(let peer): continuation.yield(.upsert(Self.peerView(peer)))
              case .peerLeft(let peer): continuation.yield(.left(Self.peerView(peer)))
              default: break
              }
            }
            continuation.finish()
          }
          continuation.onTermination = { _ in task.cancel() }
        }
      })
  }

  /// The live doors, over an app-owned runtime.
  public static func live(runtime: GhostteaTruffleRuntime) async -> FieldStoreDoors {
    live(node: await runtime.node)
  }

  /// The two keyspaces, kept apart on purpose: `tailscaleId` routes, the
  /// durable `deviceId` files a slice (RFC 017 §8), and joining them against
  /// each other is the bug T1 §6 names.
  private static func peerView(_ peer: Peer) -> FieldStorePeer {
    FieldStorePeer(id: peer.tailscaleId, deviceId: peer.deviceId, online: peer.online)
  }
}
