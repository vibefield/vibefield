import Foundation
import Testing

@testable import FieldMesh

/// TS-7 — the approval page's two facts. The console mirrors truffle-core's
/// `ControlServer::machines_admin_url` (the literal is held to field-native's
/// own test by `pnpm check:ios-fixtures`); the machine name is the name this
/// phone asked for.
@Suite("the approval page names this phone and where an admin approves it")
struct AdminConsoleTests {
  @Test("the default control server has a console; a custom one names none")
  func console() {
    #expect(
      FieldTruffleRuntime.machinesAdminURL(controlURL: nil)
        == URL(string: "https://login.tailscale.com/admin/machines"))
    #expect(FieldTruffleRuntime.machinesAdminURL(controlURL: URL(string: "https://headscale.example.com")) == nil)
  }

  @Test("the machine name is the first label of the node's MagicDNS name, else its hostname")
  func machineName() {
    #expect(FieldTruffleRuntime.machineName(dnsName: "iphone-17-pro.tail3f2a8c.ts.net.", hostname: "iPhone") == "iphone-17-pro")
    #expect(FieldTruffleRuntime.machineName(dnsName: "iphone-17-pro-1.tail3f2a8c.ts.net", hostname: "iPhone") == "iphone-17-pro-1")
    #expect(FieldTruffleRuntime.machineName(dnsName: nil, hostname: "iPhone") == "iPhone")
    #expect(FieldTruffleRuntime.machineName(dnsName: "", hostname: "iPhone") == "iPhone")
    #expect(FieldTruffleRuntime.machineName(dnsName: ".", hostname: "iPhone") == "iPhone")
  }
}
