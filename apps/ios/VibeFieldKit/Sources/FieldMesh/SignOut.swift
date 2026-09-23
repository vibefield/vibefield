import FieldAgents
import Foundation

/// Sign out (IOS-8d, AP-D4 — UA-P-D4's lean, implemented): what a phone
/// forgets when the account leaves, and what it keeps.
///
/// **Goes — what the field taught this phone:** the node's state directory
/// (the Tailscale keys, the durable device id, the remembered login, the
/// synced store), so the next CONNECT is a fresh node and a fresh sign-in;
/// this login's remembered desktops and its face; the project ledger (the
/// colours dealt to another account's projects would otherwise greet the
/// next one). **Stays — what the person taught it:** the terminal
/// appearance, the snippets, the clipboard history, and every other
/// preference. One account at a time, so there is no switch: sign out, then
/// sign in.
///
/// Pure about WHAT (the report says what went) and run by `MeshModel.signOut`
/// after the node has stopped, because removing a state directory under a
/// running node is not a sign-out, it is a crash.
public struct SignOutSweep: Sendable {
  public let login: String?
  public let stateDirectory: URL?

  public struct Report: Equatable, Sendable {
    public var removed: [String] = []
  }

  public init(login: String?, stateDirectory: URL?) {
    self.login = login
    self.stateDirectory = stateDirectory
  }

  /// The defaults keys that belong to the person and survive a sign-out —
  /// named so a test can prove each one is still there afterwards.
  public static let kept: [String] = ["vf.input.snippets", "vf.input.clipboardHistory"]

  @discardableResult
  public func run(defaults: UserDefaults = .standard, fileManager: FileManager = .default) -> Report {
    var report = Report()
    if let stateDirectory, fileManager.fileExists(atPath: stateDirectory.path) {
      if (try? fileManager.removeItem(at: stateDirectory)) != nil {
        report.removed.append("node state")
      }
    }
    if let login, !login.isEmpty {
      DesktopMemory(defaults: defaults).forget(login: login)
      AccountFaceStore(defaults: defaults).forget(login: login)
      report.removed.append("desktops")
      report.removed.append("face")
    }
    if defaults.object(forKey: UserDefaultsProjectLedgerStore.defaultKey) != nil {
      defaults.removeObject(forKey: UserDefaultsProjectLedgerStore.defaultKey)
      report.removed.append("project ledger")
    }
    return report
  }
}
