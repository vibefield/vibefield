import FieldAgents
import FieldProduct
import Foundation

// PG-3e — ONE DRAWN ROW AS ONE SWARM BODY: 3d's `RemoteFieldRow` (the replica's row, its board row and the window's
// standing and visual id) mapped straight to the swarm's `FieldBubble`, which `bodyModel` reads. Held to
// `phone-body.golden.json` step by step (`PhoneBodyParityTests`). This file imports nothing beyond FieldAgents and
// FieldProduct, so the host inner loop builds it. Skeleton until the mapping lands.

/// One drawn row's bubble. `fieldIsLive` is false while no live home answers for the copy: every body greys (the
/// phone-only grey). `catalog` is the row's desktop's (its mark only). `suppressUnread` holds the open card's row out
/// of unread while its desktop cannot hear this phone's reports (PG-3f).
public func fieldBubble(
  from row: RemoteFieldRow, fieldIsLive: Bool, catalog: AgentCatalog, suppressUnread: Bool
) -> FieldBubble {
  FieldBubble(id: "", project: "", detail: "", status: .idle, identityKey: "", createdAt: .distantPast)
}
