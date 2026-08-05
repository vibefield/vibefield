//! UA-0 — the LAYOUT registry is one authority in two languages. This pins the
//! GENERATED Rust module against the hand-pinned cross-language vector; the TS
//! twin (`contracts/test/layout.test.ts`) pins the source side against the
//! same file. A deliberate layout change edits the vector in the same commit.

use std::collections::BTreeMap;

#[test]
fn layout_matches_cross_language_fixture() {
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/layout.vector.json"),
    )
    .expect("read layout.vector.json");
    let fixture: BTreeMap<String, Vec<String>> =
        serde_json::from_str(&raw).expect("parse layout.vector.json");
    let generated: BTreeMap<String, Vec<String>> = field_native::registries::layout::ALL
        .iter()
        .map(|(name, segments)| {
            (
                (*name).to_string(),
                segments.iter().map(|s| (*s).to_string()).collect(),
            )
        })
        .collect();
    assert_eq!(
        generated, fixture,
        "generated layout diverged from the pinned vector"
    );
}
