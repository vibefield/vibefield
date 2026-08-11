import Testing

@testable import FieldTerminal

@Suite struct FieldTerminalModuleTests {
  @Test func moduleCarriesItsUpstreamVersion() {
    #expect(FieldTerminal.ghostteaVersion == "0.9.3")
  }
}
