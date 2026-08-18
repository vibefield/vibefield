//! WIN-D1 — the endpoint-resolution law is one derivation in two languages.
//! This pins the HAND-WRITTEN Rust half against the cross-language vector; the
//! TS twin (`contracts/test/endpoints.test.ts`) pins the source side against
//! the same file. A deliberate law change edits the vector in the same commit.

use serde_json::Value;

#[test]
fn endpoint_derivation_matches_cross_language_fixture() {
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/endpoint.vector.json"),
    )
    .expect("read endpoint.vector.json");
    let fixture: Value = serde_json::from_str(&raw).expect("parse endpoint.vector.json");
    let vectors = fixture["vectors"].as_array().expect("vectors array");
    assert!(!vectors.is_empty(), "empty vector file pins nothing");
    for vector in vectors {
        let tag = vector["tag"].as_str().expect("tag");
        let data_root = vector["dataRoot"].as_str().expect("dataRoot");
        let scope = vector["scope"].as_str().expect("scope");
        assert_eq!(
            field_native::endpoints::pipe_scope(data_root),
            scope,
            "{tag}: scope diverged from the pinned vector"
        );
        for (socket_file, endpoint) in vector["endpoints"].as_object().expect("endpoints") {
            let expected = endpoint.as_str().expect("endpoint string");
            assert_eq!(
                field_native::endpoints::pipe_endpoint_for(data_root, socket_file),
                expected,
                "{tag}/{socket_file}: endpoint diverged from the pinned vector"
            );
            assert!(field_native::endpoints::is_pipe_endpoint(expected));
        }
    }
}

#[test]
fn spellings_of_one_windows_directory_share_a_scope() {
    assert_eq!(
        field_native::endpoints::pipe_scope(r"C:\A\B\"),
        field_native::endpoints::pipe_scope("c:/a/b"),
    );
}

#[test]
fn cell_socket_names_match_the_ts_twin() {
    // TC-S2 — the per-instance derivation; the fixture's termctl.2 rows pin
    // the DERIVED name through the pipe law, this row pins the derivation.
    assert_eq!(
        field_native::endpoints::cell_socket_file("termctl.sock", 2),
        "termctl.2.sock"
    );
    assert_eq!(
        field_native::endpoints::cell_socket_file("termframe.sock", 1),
        "termframe.1.sock"
    );
}
