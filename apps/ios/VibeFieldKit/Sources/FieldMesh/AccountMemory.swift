import FieldDesign
import Foundation

/// What this phone remembers about an account between sightings (IOS-8c):
/// the desktops it has listed (AP-D6) and the face it wears (AP-D3). Both are
/// keyed by the LOGIN — the account is the ground, and a phone that changes
/// hands to another login must not draw the first login's desktops or face.
/// Both are what "the field taught this phone", so sign out clears them
/// (AP-D4); appearance and snippets are the person's and stay.
public struct RememberedDesktop: Codable, Equatable, Sendable {
  public let deviceId: String
  public let name: String
  public let lastSeen: Date

  public init(deviceId: String, name: String, lastSeen: Date) {
    self.deviceId = deviceId
    self.name = name
    self.lastSeen = lastSeen
  }
}

/// The desktops an account has: every self desktop the link has ever listed
/// on this phone. A desktop the tailnet does not list right now — its node
/// off, the machine asleep — is a row that says `asleep` rather than a
/// desktop that never existed, which is what makes "an account has desktops"
/// visible when they are not all awake.
public struct DesktopMemory {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  static func key(for login: String) -> String {
    "vf.account.desktops." + login.lowercased()
  }

  public func remembered(for login: String) -> [RememberedDesktop] {
    guard let data = defaults.data(forKey: Self.key(for: login)) else { return [] }
    return (try? JSONDecoder().decode([RememberedDesktop].self, from: data)) ?? []
  }

  /// Record the desktops the link lists, by device id: a known desktop keeps
  /// its place and takes the name it reports now; a new one is appended.
  /// Nothing is ever dropped here — a desktop leaves this memory only with
  /// the account (sign out).
  public func record(_ desktops: [FieldDesktop], login: String, at now: Date = Date()) {
    guard !login.isEmpty, !desktops.isEmpty else { return }
    var rows = remembered(for: login)
    for desktop in desktops {
      let row = RememberedDesktop(deviceId: desktop.deviceId, name: desktop.name, lastSeen: now)
      if let index = rows.firstIndex(where: { $0.deviceId == desktop.deviceId }) {
        rows[index] = row
      } else {
        rows.append(row)
      }
    }
    if let data = try? JSONEncoder().encode(rows) {
      defaults.set(data, forKey: Self.key(for: login))
    }
  }

  public func forget(login: String) {
    defaults.removeObject(forKey: Self.key(for: login))
  }
}

/// DS-8 (DS-D13) — the desktop this phone last read its field through: its
/// HOME, by durable device id, per login. The phone homes to its last home
/// when it answers, else to the first self desktop whose door answers, and
/// re-homes by the roster when the home stops answering — and the desktop it
/// re-homed to becomes the last home. One per login, never a list; another
/// login's home is another login's; and sign out forgets it with the rest of
/// what the field taught this phone (AP-D4).
public struct HomeMemory {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  static func key(for login: String) -> String {
    "vf.account.home." + login.lowercased()
  }

  public func lastHome(for login: String) -> String? {
    guard !login.isEmpty else { return nil }
    let home = defaults.string(forKey: Self.key(for: login))
    return home?.isEmpty == false ? home : nil
  }

  /// An empty login records nowhere: the pre-login window knows no account to
  /// file a home under.
  public func record(_ deviceId: String, login: String) {
    guard !login.isEmpty, !deviceId.isEmpty else { return }
    defaults.set(deviceId, forKey: Self.key(for: login))
  }

  public func forget(login: String) {
    defaults.removeObject(forKey: Self.key(for: login))
  }
}

/// The face this phone wears for an account.
///
/// Until the door carries the desktop's own face (IOS-8f, `user.me`), the
/// phone DEALS one from the same deck with the same hash as the desktop, from
/// the user ULID the first self desktop reports at hello (`HelloAck.userId`)
/// — which is that desktop's own dealt face wherever its user has not changed
/// it. Dealt once per login and kept: a later desktop of the same login with
/// another ULID does not move it, because a face that moved would be the
/// opposite of an identity.
public struct AccountFaceStore {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  static func key(for login: String) -> String {
    "vf.account.face." + login.lowercased()
  }

  public func face(for login: String) -> UserFace? {
    guard let data = defaults.data(forKey: Self.key(for: login)) else { return nil }
    return try? JSONDecoder().decode(UserFace.self, from: data)
  }

  /// The face for `login`, dealing one from `userId` if none is kept yet.
  @discardableResult
  public func dealIfNeeded(login: String, userId: String) -> UserFace {
    if let kept = face(for: login) { return kept }
    let dealt = UserFace(emoji: FaceDeck.deal(seed: userId), frame: .sticker)
    set(dealt, for: login)
    return dealt
  }

  /// The desktop's own word on the face, when the door carries it (IOS-8f):
  /// it overrides a deal.
  public func set(_ face: UserFace, for login: String) {
    guard !login.isEmpty, let data = try? JSONEncoder().encode(face) else { return }
    defaults.set(data, forKey: Self.key(for: login))
  }

  public func forget(login: String) {
    defaults.removeObject(forKey: Self.key(for: login))
  }
}
