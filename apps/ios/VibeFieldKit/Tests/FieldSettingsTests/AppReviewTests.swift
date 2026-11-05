import FieldDesign
import Foundation
import Testing
import UIKit

@testable import FieldSettings

/// IOS-13a — Settings for App Review (the 0.9 launch's phase 3; DESIGN.md §8 "The phone's Settings" and §9 "The
/// phone's legal words", 2026-11-05): the site's addresses as one pair, About's links and its foot, the
/// acknowledgements the app carries, and the device named as its platform names it.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Settings says what App Review asks, in DESIGN.md's words")
struct AppReviewTests {
  // MARK: - S1: the site's addresses

  @Test("the site's addresses are one pair beside its home, and nothing else in the app names them")
  func site() {
    let home = VibeFieldSite.home.absoluteString
    let privacy = VibeFieldSite.privacy.absoluteString
    let support = VibeFieldSite.support.absoluteString
    #expect(home == "https://vibefield.dev")
    #expect(privacy == "https://vibefield.dev/privacy")
    #expect(support == "https://vibefield.dev/support")
  }

  // MARK: - S2: About

  @Test("About reaches the privacy policy and support, in Apple's own words, from the one pair")
  func aboutLinks() {
    let links = SettingsModel.aboutLinks
    let titles = links.map { $0.title }
    let urls = links.map { $0.url }
    #expect(titles == ["Privacy Policy", "Support"])
    #expect(urls == [VibeFieldSite.privacy, VibeFieldSite.support])
  }

  @Test("About's foot: Tailscale's trademark line, then the non-affiliation line, word for word")
  func aboutFoot() {
    #expect(
      SettingsModel.aboutFoot == [
        "Tailscale is a registered trademark of Tailscale Inc.",
        "VibeField names agents such as Claude Code and Codex to tell sessions apart. "
          + "It isn’t affiliated with or endorsed by Anthropic or OpenAI.",
      ])
  }

  // MARK: - S4: Acknowledgements

  private struct FixtureUnread: Error {}

  /// L5's acknowledgements as its lane wrote them at `a76cc7aba`, trimmed to eight parts and every text they name, with
  /// one field this build does not know (`homepage`, on OpenSSL).
  private func fixture() throws -> AcknowledgementsDoc {
    let found = Bundle.module.url(
      forResource: "acknowledgements-l5.lane", withExtension: "json", subdirectory: "Fixtures")
    let url = try #require(found)
    let state = Acknowledgements.load(url: url)
    guard case .bundled(let doc) = state else {
      Issue.record("the fixture reads as \(state)")
      throw FixtureUnread()
    }
    return doc
  }

  private func part(_ name: String, in doc: AcknowledgementsDoc) throws -> AcknowledgementsDoc.Part {
    let found = doc.parts.first { $0.name == name }
    return try #require(found)
  }

  private func said(_ resolved: Acknowledgements.Resolved) -> String {
    switch resolved {
    case .text(let text): return "\(text.kind) \(text.files.joined(separator: ", "))"
    case .missing(let id): return "missing \(id)"
    }
  }

  @Test("one path: L5's basename, read from the app's own bundle")
  func resource() {
    let name = Acknowledgements.resource.name
    let ext = Acknowledgements.resource.ext
    #expect(name == "acknowledgements")
    #expect(ext == "json")
  }

  @Test("absent: no file in the bundle is said as absent, above the short list (Q5)")
  func absent() {
    #expect(Acknowledgements.load(url: nil) == .absent)
    // The test bundle carries L5's copy only under Fixtures/, so its top level has none: every build before L4's.
    #expect(Acknowledgements.load(bundle: .module) == .absent)
    #expect(SettingsWords.acknowledgementsAbsent == "Acknowledgements aren’t in this build.")
  }

  @Test("unreadable: another schema, not JSON, or a part with no name, said with its reason and never blank")
  func unreadable() {
    let schema2 = Acknowledgements.parse(Data(#"{"schema": 2, "components": [], "texts": []}"#.utf8))
    #expect(schema2 == .unreadable("schema 2, and this build reads 1"))
    let prose = Acknowledgements.parse(Data("MIT License".utf8))
    #expect(prose == .unreadable("it isn’t JSON"))
    let nameless = Acknowledgements.parse(
      Data(#"{"schema": 1, "components": [{"licence": "MIT", "texts": []}], "texts": []}"#.utf8))
    #expect(nameless == .unreadable("a part has no name"))
    #expect(
      SettingsWords.acknowledgementsUnreadable("schema 2, and this build reads 1")
        == "This build’s acknowledgements can’t be read: schema 2, and this build reads 1.")
  }

  @Test("bundled: L5's parts and its texts by id; a field this build doesn't know is kept and named")
  func bundled() throws {
    let doc = try fixture()
    #expect(doc.parts.count == 8)
    #expect(doc.texts.count == 11)
    #expect(doc.unknown == ["OpenSSL.homepage"])
  }

  @Test("the groups: L5's roles as sentences, the fixed five first, then the rest by name")
  func groups() throws {
    let doc = try fixture()
    let groups = Acknowledgements.groups(doc)
    let titles = groups.map { $0.title }
    #expect(
      titles == [
        "The terminal", "The private network", "The terminal's fonts", "The agents' marks",
        "TailscaleKit", "The terminal (ghosttea)", "The terminal's ember effect",
      ])
    let ghostteaDeps = groups.first { $0.title == "The terminal (ghosttea)" }?.parts.map { $0.name }
    #expect(ghostteaDeps == ["anyhow", "OpenSSL"])
  }

  @Test("a row: the name, its version under it, its licence as the value; no version, no line")
  func rows() throws {
    let doc = try fixture()
    let ghosttea = try part("ghosttea", in: doc)
    let sparks = try part("Sparks from Fire (shader)", in: doc)
    #expect(Acknowledgements.row(ghosttea) == .init(title: "ghosttea", detail: "0.14.0", value: "MIT"))
    #expect(Acknowledgements.row(sparks) == .init(title: "Sparks from Fire (shader)", detail: nil, value: "CC-BY-3.0"))
  }

  @Test("a part's texts resolve by id, in its order; a text the file lacks is named, never dropped")
  func texts() throws {
    let doc = try fixture()
    let anyhow = try part("anyhow", in: doc)
    let resolved = Acknowledgements.texts(of: anyhow, in: doc)
    let words = resolved.map(said)
    #expect(words == ["Apache-2.0 LICENSE-APACHE", "MIT LICENSE, LICENSE-MIT, LICENSE-MIT.md"])
    guard case .text(let apache) = resolved.first else {
      Issue.record("anyhow's first text did not resolve")
      return
    }
    #expect(apache.body.contains("Apache License"))
    var stray = anyhow
    stray.texts = ["a3f177dc04ae", "000000000000"]
    let strays = Acknowledgements.texts(of: stray, in: doc).map(said)
    #expect(strays == ["MIT LICENSE, LICENSE, TRUFFLE-LICENSE", "missing 000000000000"])
    #expect(SettingsWords.textMissing("000000000000") == "This text isn’t in the build: 000000000000.")
  }

  // MARK: - S5: the device word (Q1)

  @Test("the device word: the idiom in, the platform's own word out, and the device where it is neither")
  func deviceWord() {
    #expect(DeviceWord(.phone) == .iPhone)
    #expect(DeviceWord(.pad) == .iPad)
    #expect(DeviceWord(.mac) == .unknown)
    #expect(DeviceWord(.unspecified) == .unknown)
    let devices: [DeviceWord] = [.iPhone, .iPad, .unknown]
    let this = devices.map { $0.this }
    let capital = devices.map { $0.This }
    #expect(this == ["this iPhone", "this iPad", "this device"])
    #expect(capital == ["This iPhone", "This iPad", "This device"])
  }
}
