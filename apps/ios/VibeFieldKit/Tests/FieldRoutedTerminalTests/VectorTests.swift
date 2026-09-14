import CryptoKit
import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// EL9's THIRD SIDE.
///
/// A seam is pinned by fixtures parsed on both sides; the phone is the third,
/// and it holds COPIES because its bundle cannot reach across the workspace.
/// `pnpm check:ios-fixtures` keeps the word "copy" true byte for byte — these
/// tests are what makes the bytes MEAN something: the same three vectors the
/// TypeScript contracts test and the Rust cell's fixture tests parse, read here
/// by the shipping readers and asserted against the values the vectors pin.
///
/// The phone never MINTS a grant, so the MAC vector is read from the carrying
/// side: the canonical signing input this client computes over a grant it
/// received must be the one fieldd signed, and the MAC must verify against the
/// vector's key. That is not a shipping path — the phone holds no key — but it
/// is the only way to prove this build's canonicalization agrees with the two
/// implementations that do the real work.
enum Vector {
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw Failure.missing(name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  enum Failure: Error, CustomStringConvertible {
    case missing(String)
    var description: String {
      switch self {
      case .missing(let name): "vector `\(name).json` is not in the test bundle"
      }
    }
  }

  static func hex(_ text: String) -> Data {
    var bytes = Data()
    var index = text.startIndex
    while index < text.endIndex, text.index(after: index) < text.endIndex {
      let next = text.index(index, offsetBy: 2)
      bytes.append(UInt8(text[index..<next], radix: 16) ?? 0)
      index = next
    }
    return bytes
  }
}

@Suite struct CanonicalJsonVectorTests {
  /// `tp-jcs.vector.json` — the RFC 8785 example. Byte for byte, or the grant
  /// MACs this client carries cannot be the ones the cell verifies.
  @Test func theRfcExampleCanonicalizesByteForByte() throws {
    let vector = try Vector.json("tp-jcs.vector")
    let input = try #require(vector["input"])
    let expected = try #require(vector["canonical"]?.stringValue)
    #expect(try RoutedCanonicalJson.text(input) == expected)
  }

  /// ECMAScript's placement rules, which are the half of RFC 8785 that Swift's
  /// own `description` does NOT give: `1e-06` vs `0.000001`, `5.0` vs `5`, and
  /// the exact thresholds at 1e21 and 1e-7. Every row here is one the Rust twin
  /// (`jcs.rs`) asserts, so the two are pinned to each other and not only to the
  /// vector.
  @Test func numbersFollowEcmascriptPlacement() throws {
    let rows: [(Double, String)] = [
      (1, "1"),
      (-1.5, "-1.5"),
      (1e21, "1e+21"),
      (1e20, "100000000000000000000"),
      (123456789012345680000.0, "123456789012345680000"),
      (1e-6, "0.000001"),
      (1e-7, "1e-7"),
      (0.1, "0.1"),
      (1.5e300, "1.5e+300"),
      (5e-324, "5e-324"),
      (-0.0, "0"),
      (1787788800000.0, "1787788800000"),
      (4.5, "4.5"),
      (0.002, "0.002"),
      (333333333.3333333, "333333333.3333333"),
    ]
    for (value, expected) in rows {
      #expect(try RoutedCanonicalJson.esNumberToString(value) == expected, "\(value)")
    }
    #expect(throws: RoutedCanonicalJson.Failure.nonFinite) {
      try RoutedCanonicalJson.esNumberToString(.nan)
    }
    #expect(throws: RoutedCanonicalJson.Failure.nonFinite) {
      try RoutedCanonicalJson.esNumberToString(.infinity)
    }
  }

  /// Property names sort by UTF-16 CODE UNITS, not codepoints. U+FF5E is one
  /// code unit (0xFF5E); U+1D11E is a surrogate pair (0xD834 0xDD1E), so UTF-16
  /// order puts the pair FIRST where Swift's own `<` would not.
  @Test func keysSortByUtf16CodeUnits() throws {
    let value = JSONValue.object(["\u{FF5E}": .int(1), "\u{1D11E}": .int(2)])
    #expect(try RoutedCanonicalJson.text(value) == "{\"\u{1D11E}\":2,\"\u{FF5E}\":1}")
  }

  /// `JSON.stringify`'s escaping exactly: the short escapes, `\u00xx` lowercase
  /// for the other C0 controls, and NOTHING else — `/` unescaped, DEL literal,
  /// non-ASCII literal.
  @Test func stringsEscapeLikeJsonStringify() throws {
    let value = JSONValue.string("a\"b\\c\u{1}\u{7f}/€")
    #expect(try RoutedCanonicalJson.text(value) == "\"a\\\"b\\\\c\\u0001\u{7f}/€\"")
  }

  /// An integer stays an integer. `expiresAt` is a millisecond counter, and a
  /// canonicalizer that put `1.7877888e+12` under a MAC would break every grant
  /// it touched.
  @Test func integersAreNotWidenedToDoubles() throws {
    #expect(try RoutedCanonicalJson.text(.int(1_787_788_800_000)) == "1787788800000")
    #expect(try RoutedCanonicalJson.text(.int(0)) == "0")
    #expect(try RoutedCanonicalJson.text(.int(-7)) == "-7")
  }
}

@Suite struct GrantVectorTests {
  /// `tp-grant-mac.vector.json` — both grants, from the CARRYING side: the
  /// signing input this client computes over what it received is the one fieldd
  /// signed, and the MAC verifies against the vector's per-cell-boot key.
  @Test func bothGrantsCanonicalizeAndVerify() throws {
    let vector = try Vector.json("tp-grant-mac.vector")
    let key = Vector.hex(try #require(vector["keyHex"]?.stringValue))
    for which in ["transport", "attach"] {
      let row = try #require(vector[which])
      let grant = try RoutedGrant(
        json: .object([
          "protected": try #require(row["protected"]),
          "claims": try #require(row["claims"]),
          "mac": try #require(row["mac"]),
        ]))
      let signingInput = try grant.signingInput()
      #expect(
        String(data: signingInput, encoding: .utf8) == row["signingInput"]?.stringValue, "\(which)")
      #expect(try grant.verifyMac(key: key), "\(which)")
      // A key that is not the cell's must not verify — the assertion that makes
      // the one above mean something.
      #expect(try !grant.verifyMac(key: Data(repeating: 0x5f, count: 32)), "\(which)")
    }
  }

  /// The claims each grant type carries, read by the shipping accessors.
  @Test func theClaimsReadAsTheContractSpellsThem() throws {
    let vector = try Vector.json("tp-grant-mac.vector")
    let transport = try RoutedGrant(json: grantJson(vector, "transport"))
    #expect(transport.kind == .transport)
    #expect(transport.keyId.cellBootId == "cb-7f3a9c1e-2026")
    #expect(transport.keyId.keyGeneration == 1)
    #expect(transport.connectionSetId == "cs-win-3c4d-2-cb-7f3a9c1e")
    #expect(transport.transportGrantGeneration == 3)
    #expect(transport.allows(.control))
    #expect(transport.allows(.frames))
    #expect(transport.nonce == "Qk9PVC1OT05DRS0wMDE")

    let attach = try RoutedGrant(json: grantJson(vector, "attach"))
    #expect(attach.kind == .attach)
    #expect(attach.sessionId == "sess-01J8Z3K9")
    #expect(attach.leaseEpoch == 4)
    #expect(attach.routeRevision == 12)
    #expect(attach.grantGeneration == 1)
    #expect(attach.has(.input))
    #expect(attach.has(.read))
    #expect(attach.has(.geometry))
    #expect(!attach.has(.geometryAdmin))
  }

  /// The two limits, applied locally so a dead grant costs no socket. The
  /// lifetime bound is checked FIRST: a grant that violates it is malformed
  /// whatever the clock says.
  @Test func validityIsTheSpecsThreePredicates() throws {
    let vector = try Vector.json("tp-grant-mac.vector")
    let attach = try RoutedGrant(json: grantJson(vector, "attach"))
    // issuedAt 1787788800000, expiresAt 1787789400000 — a 10-minute lifetime.
    #expect(attach.validity(at: 1_787_788_800_000) == .valid)
    #expect(attach.validity(at: 1_787_788_794_999) == .notYetValid)
    #expect(attach.validity(at: 1_787_788_795_001) == .valid)
    #expect(attach.validity(at: 1_787_789_405_000) == .expired)
    #expect(attach.validity(at: 1_787_789_404_999) == .valid)
    // The same grant against a shorter bound is MALFORMED, not expired.
    #expect(attach.validity(at: 1_787_788_800_000, maxGrantLifetimeMs: 1_000) == .lifetimeExceeded)
  }

  /// THE reason the grant is carried as received JSON rather than a struct: the
  /// MAC covers the values the cell receives, unknown fields INCLUDED. A field
  /// this build does not know is reported and re-sent, never dropped.
  @Test func anUnknownClaimSurvivesTheRoundTripAndKeepsTheMac() throws {
    let vector = try Vector.json("tp-grant-mac.vector")
    let key = Vector.hex(try #require(vector["keyHex"]?.stringValue))
    let row = try #require(vector["attach"])
    var claims = try #require(row["claims"]?.objectValue)
    claims["someFutureClaim"] = .string("a word this build has not learned")
    let protectedHeader = try #require(row["protected"])
    // Re-sign, because the vector's MAC was computed without the new field.
    let signing = try RoutedCanonicalJson.bytes(
      .object(["protected": protectedHeader, "claims": .object(claims)]))
    let mac = RoutedBase64URL.encode(hmacSha256(key: key, message: signing))
    let grant = try RoutedGrant(
      json: .object(["protected": protectedHeader, "claims": .object(claims), "mac": .string(mac)]))
    #expect(try grant.verifyMac(key: key))
    // And it is still there in what would go on the wire.
    #expect(grant.raw["claims"]?["someFutureClaim"]?.stringValue != nil)
  }

  private func grantJson(_ vector: JSONValue, _ which: String) -> JSONValue {
    .object([
      "protected": vector[which]?["protected"] ?? .null,
      "claims": vector[which]?["claims"] ?? .null,
      "mac": vector[which]?["mac"] ?? .null,
    ])
  }
}

@Suite struct EnvelopeVectorTests {
  /// `tp-envelope.vector.json` — the binary framing, both ways.
  ///
  /// The vector pins the exact bytes (`wireBase64`), the header, the payload and
  /// `chargedBytes`. The charge is the WHOLE message length as received, which is
  /// the number the credit ledger spends; getting it from anywhere else is the
  /// ledger desync the contract removed a field to prevent.
  @Test func theWireVectorDecodesToItsHeaderPayloadAndCharge() throws {
    let vector = try Vector.json("tp-envelope.vector")
    let base64 = try #require(vector["wireBase64"]?.stringValue)
    let wire = try #require(Data(base64Encoded: base64))
    let charged = try #require(vector["chargedBytes"]?.intValue)
    let payloadHex = try #require(vector["payloadHex"]?.stringValue)
    let envelope = try RoutedPresentationEnvelope.decode(wire)

    #expect(envelope.chargedBytes == Int(charged))
    #expect(envelope.chargedBytes == wire.count)
    #expect(envelope.header.kind == .trf1Frame)
    #expect(envelope.header.creditEpoch == 1)
    #expect(envelope.header.activationSequence == 88)
    #expect(envelope.header.sessionId == "sess-01J8Z3K9")
    #expect(envelope.header.activationId == "act-01")
    #expect(envelope.header.leaseEpoch == 4)
    #expect(envelope.header.baseContent?.sceneRevision == 4416)
    #expect(envelope.header.resultContent?.sceneRevision == 4417)
    #expect(envelope.header.resultContent?.cellBootId == "cb-7f3a9c1e-2026")
    #expect(Data(envelope.payload) == Vector.hex(payloadHex))
    // The payload is a VIEW: its indices start where the header ended, not at
    // zero. A reader that assumed otherwise would crash on a real frame.
    #expect(envelope.payload.startIndex == wire.count - envelope.payload.count)
  }

  /// The encoder — which only the fake door uses — writes the FRAMING exactly
  /// and round-trips the vector's header and payload.
  ///
  /// It does NOT reproduce the vector's bytes one for one, and that is a fact
  /// about the contract rather than a gap here: the header's key ORDER is
  /// whatever the sender's JSON writer chose, a receiver PARSES it, and nothing
  /// on this wire ever compares two encodings of one header. (The grant MAC is
  /// the opposite case, which is exactly why it has a canonical form and this
  /// does not.) So what is asserted is what is promised: the 8-byte prefix, a
  /// length that matches the header it announces, and a decode that yields the
  /// same header and the same payload.
  @Test func theEncoderWritesTheFramingAndRoundTrips() throws {
    let vector = try Vector.json("tp-envelope.vector")
    let header = try #require(vector["header"])
    let payloadHex = try #require(vector["payloadHex"]?.stringValue)
    let payload = Vector.hex(payloadHex)
    let wire = try RoutedPresentationEnvelope.encode(header: header, payload: payload)

    #expect(Array(wire.prefix(4)) == [0x54, 0x50, 0x01, 0x00])
    let declared =
      (Int(wire[4]) << 24) | (Int(wire[5]) << 16) | (Int(wire[6]) << 8) | Int(wire[7])
    #expect(wire.count == 8 + declared + payload.count)

    let base64 = try #require(vector["wireBase64"]?.stringValue)
    let vectorWire = try #require(Data(base64Encoded: base64))
    let decoded = try RoutedPresentationEnvelope.decode(wire)
    let original = try RoutedPresentationEnvelope.decode(vectorWire)
    #expect(decoded.header == original.header)
    #expect(Data(decoded.payload) == payload)
    #expect(decoded.chargedBytes == wire.count)
  }
}

/// HMAC-SHA256 for the one test that re-signs a grant — the phone never signs
/// one, so this is the test's own, not a shipping path made public for it.
private func hmacSha256(key: Data, message: Data) -> Data {
  Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key)))
}
