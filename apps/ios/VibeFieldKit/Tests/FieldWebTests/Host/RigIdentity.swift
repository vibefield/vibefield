import CryptoKit
import Foundation
import Network
import Security
import WebKit

@testable import FieldWeb

/// SP-4c's rig — the test identity, and the TEST target's one trust door.
///
/// The identity is made per run by `make-rig-identity.sh` into the run's own folder, outside the repository, as a
/// mode-600 PKCS#12 file. The run's environment carries only its PATH and the file's SHA-256
/// (`TEST_RUNNER_VF_RIG_P12_PATH`, `TEST_RUNNER_VF_RIG_P12_SHA256`, which `xcodebuild test` hands over without the
/// prefix), never the key's bytes: an environment is what a red, a crash report or a child process copies.
/// The test reads the file (a simulator test process reads the host's filesystem), checks its digest, and
/// imports it. It is never committed and never written into the tree. Without it W2 says "not
/// made" and fails, and every row that needs it is skipped by name.
///
/// Server trust is decided nowhere in the kit's or the app's sources (`check-web-markers.mjs`
/// holds it). Only `RigNavigation`, declared here and passed by the rows alone, trusts a certificate, and only the
/// rig's own, by its SHA-256.
enum RigIdentity {
  enum Missing: Error { case notMade, unreadable, digestMismatch, notImported }

  /// The identity as the rows use it: for the servers, and the certificate's digest for `RigNavigation`.
  struct Loaded {
    let identity: sec_identity_t
    let certificateDigest: Data
  }

  /// PKCS#12's passphrase: a fixed PUBLIC constant. The rig relies on the file's digest, not on its secrecy.
  static let passphrase = "rig"

  static var path: String { ProcessInfo.processInfo.environment["VF_RIG_P12_PATH"] ?? "" }
  static var fileDigest: String { ProcessInfo.processInfo.environment["VF_RIG_P12_SHA256"] ?? "" }

  /// Whether this run was handed an identity at all.
  static var made: Bool { !path.isEmpty && fileDigest.count == 64 }

  /// Why a row did not run: named, so a skipped row is never read as a pass.
  static let notMade = "SP4C: the rig identity was not made for this run (make-rig-identity.sh); this row did not run"

  /// The identity, read from its file, its digest checked, and imported in memory.
  static func load() throws -> Loaded {
    guard made, let wanted = Data(hex: fileDigest) else { throw Missing.notMade }
    guard let p12 = FileManager.default.contents(atPath: path) else { throw Missing.unreadable }
    guard Data(SHA256.hash(data: p12)) == wanted else { throw Missing.digestMismatch }
    var items: CFArray?
    let options = [kSecImportExportPassphrase as String: passphrase] as CFDictionary
    let status = SecPKCS12Import(p12 as CFData, options, &items)
    guard status == errSecSuccess, let first = (items as? [[String: Any]])?.first,
      let found = first[kSecImportItemIdentity as String]
    else { throw Missing.notImported }
    let identity = found as! SecIdentity
    var certificate: SecCertificate?
    guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess, let certificate,
      let made = sec_identity_create(identity)
    else { throw Missing.notImported }
    let digest = Data(SHA256.hash(data: SecCertificateCopyData(certificate) as Data))
    return Loaded(identity: made, certificateDigest: digest)
  }

  /// The rig certificate's SHA-256, from the imported identity itself.
  static var pinned: Data? { try? load().certificateDigest }
}

/// The rows' navigation delegate: the host's own decisions, plus a certificate trust for the rig's certificate alone.
@MainActor
final class RigNavigation: FieldWebAppNavigation {
  private let pinned: Data

  init(policy: WebNavigationPolicy, pinned: Data) {
    self.pinned = pinned
    super.init(policy: policy)
  }

  /// The first compile checks that this is the selector WebKit asks for (the superclass implements none).
  @objc(webView:didReceiveAuthenticationChallenge:completionHandler:)
  func webView(
    _ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust,
      let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
      Data(SHA256.hash(data: SecCertificateCopyData(leaf) as Data)) == pinned
    else {
      return completionHandler(.performDefaultHandling, nil)
    }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }
}

extension Data {
  init?(hex: String) {
    guard hex.count == 64 else { return nil }
    var bytes: [UInt8] = []
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }
}
