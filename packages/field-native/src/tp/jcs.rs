//! RFC 8785 — the JSON Canonicalization Scheme, as the grant MAC input
//! (terminal-pipeline-v3 §5.1: "canonical encoding = RFC 8785 JSON — the
//! contracts corpus is zod/JSON; no second serializer"). The TypeScript side is
//! `canonicalJson` in `@vibefield/contracts` (`JSON.stringify` semantics per
//! value, keys sorted by UTF-16 code units); this is its byte-exact twin, pinned
//! by the same vector (`fixtures/tp-jcs.vector.json` — the RFC's own example)
//! and by the grant-MAC vector's `signingInput`.
//!
//! Numbers follow ECMAScript `Number::toString` (the RFC's rule): shortest
//! round-trip digits, plain notation for 1e-7 < |x| < 1e21, exponent form with
//! an explicit sign otherwise. Integers beyond 2^53 are first widened to the
//! double a JavaScript reader would have parsed, so both sides agree even on a
//! value neither should ever carry.

use serde_json::Value;
use std::fmt::Write as _;

/// The one way canonicalization can fail: a number JSON cannot carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JcsError {
    NonFinite,
}
impl std::fmt::Display for JcsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JcsError::NonFinite => {
                f.write_str("canonical JSON cannot represent a non-finite number")
            }
        }
    }
}
impl std::error::Error for JcsError {}

/// The canonical UTF-8 text of `value` (RFC 8785 §3).
pub fn canonical_json(value: &Value) -> Result<String, JcsError> {
    let mut out = String::new();
    write_value(value, &mut out)?;
    Ok(out)
}

fn write_value(value: &Value, out: &mut String) -> Result<(), JcsError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                write_integer(i as i128, out);
            } else if let Some(u) = n.as_u64() {
                write_integer(u as i128, out);
            } else {
                let f = n.as_f64().ok_or(JcsError::NonFinite)?;
                out.push_str(&es_number_to_string(f)?);
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            // RFC 8785 §3.2.3: property names sorted by their UTF-16 code units.
            // Rust's String order is codepoint order, which differs for
            // supplementary-plane characters vs U+E000–U+FFFF — so compare the
            // UTF-16 encodings, not the bytes.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_value(&map[key], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// JSON.stringify's string escaping: `"` `\` and the C0 controls — the short
/// escapes where ECMAScript has them, `\u00xx` (lowercase hex) otherwise;
/// everything else literal (non-ASCII included, `/` unescaped, DEL literal).
fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

const MAX_SAFE_INTEGER: i128 = 9_007_199_254_740_992; // 2^53

fn write_integer(i: i128, out: &mut String) {
    if i.abs() <= MAX_SAFE_INTEGER {
        let _ = write!(out, "{i}");
    } else {
        // A JavaScript reader parsed this into a double; canonicalize THAT.
        let f = i as f64;
        out.push_str(&es_number_to_string(f).unwrap_or_else(|_| "0".to_string()));
    }
}

/// ECMAScript `Number::toString(10)` for a finite double. Rust's `{:e}` yields
/// the shortest round-trip digits (the same digits ES mandates); this applies
/// the ES placement rules to them.
pub fn es_number_to_string(f: f64) -> Result<String, JcsError> {
    if !f.is_finite() {
        return Err(JcsError::NonFinite);
    }
    if f == 0.0 {
        return Ok("0".to_string()); // JSON.stringify(-0) === "0"
    }
    let sci = format!("{:e}", f.abs()); // e.g. "3.333333333333333e8", "1e30", "2e-3"
    let (mantissa, exp) = sci
        .split_once('e')
        .expect("{:e} always carries an exponent");
    let exp: i32 = exp.parse().expect("{:e} exponent parses");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1; // value = 0.d1d2…dk × 10^n
    let mut out = String::new();
    if f < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            let _ = write!(out, "{}e{}{}", digits, sign, e.abs());
        } else {
            let _ = write!(out, "{}.{}e{}{}", &digits[..1], &digits[1..], sign, e.abs());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> Value {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(&p).expect("fixture read")).expect("json")
    }

    #[test]
    fn the_rfc_example_vector_is_byte_exact() {
        let v = fixture("tp-jcs.vector.json");
        let got = canonical_json(&v["input"]).unwrap();
        assert_eq!(got, v["canonical"].as_str().unwrap());
    }

    #[test]
    fn the_grant_mac_vector_signing_inputs_are_byte_exact() {
        let v = fixture("tp-grant-mac.vector.json");
        for which in ["transport", "attach"] {
            let g = &v[which];
            let signing = json!({ "protected": g["protected"], "claims": g["claims"] });
            assert_eq!(
                canonical_json(&signing).unwrap(),
                g["signingInput"].as_str().unwrap(),
                "{which}"
            );
        }
    }

    #[test]
    fn es_number_placement_rules() {
        for (f, want) in [
            (1.0, "1"),
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
        ] {
            assert_eq!(es_number_to_string(f).unwrap(), want, "{f}");
        }
        assert!(es_number_to_string(f64::NAN).is_err());
    }

    #[test]
    fn keys_sort_by_utf16_code_units_not_codepoints() {
        // U+FF5E (BMP, one code unit 0xFF5E) vs U+1D11E (surrogates 0xD834 0xDD1E):
        // UTF-16 order puts the surrogate pair FIRST; codepoint order would not.
        let mut map = serde_json::Map::new();
        map.insert("\u{FF5E}".into(), json!(1));
        map.insert("\u{1D11E}".into(), json!(2));
        let got = canonical_json(&Value::Object(map)).unwrap();
        assert_eq!(got, "{\"\u{1D11E}\":2,\"\u{FF5E}\":1}");
    }

    #[test]
    fn strings_escape_like_json_stringify() {
        let got = canonical_json(&json!("a\"b\\c\u{1}\u{7f}/€")).unwrap();
        assert_eq!(got, "\"a\\\"b\\\\c\\u0001\u{7f}/€\"");
    }
}
