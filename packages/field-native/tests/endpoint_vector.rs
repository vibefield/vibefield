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

/// Item 345 (PLAN-345-r2) — R1, the unix arm against the same `unixVectors` contracts' endpoints.test.ts reads:
/// `unix_socket_dir` and `unix_endpoint_for` for every file, the longest file, the 103/104 edge (each vector's worst
/// real bytes and its branch), the no-mix rule, and the scope. RED at S1: the alias rows.
#[test]
fn unix_endpoint_law_matches_the_cross_language_fixture() {
    use field_native::endpoints as ep;
    let parent = ep::SOCKET_ALIAS_PARENT;
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/endpoint.vector.json"),
    )
    .expect("read endpoint.vector.json");
    let fixture: Value = serde_json::from_str(&raw).expect("parse endpoint.vector.json");
    let vectors = fixture["unixVectors"]
        .as_array()
        .expect("unixVectors array");
    assert_eq!(
        vectors.len(),
        6,
        "macFits, edge103, edge104, devShape, mac24, mac255"
    );
    assert_eq!(ep::longest_socket_file(), "termframe.4294967295.sock");
    let socket_files: Vec<&str> = field_native::registries::layout::ALL
        .iter()
        .filter_map(|(_, segments)| segments.last().copied())
        .filter(|last| last.ends_with(".sock"))
        .collect();
    for vector in vectors {
        let tag = vector["tag"].as_str().expect("tag");
        let uid = u32::try_from(vector["uid"].as_u64().expect("uid")).expect("a u32 uid");
        let data_root = vector["dataRoot"].as_str().expect("dataRoot");
        let branch = vector["branch"].as_str().expect("branch");
        let real = ep::native_run_dir_for(data_root);
        assert_eq!(
            format!("{real}/{}", ep::longest_socket_file()).len() as u64,
            vector["worstRealBytes"].as_u64().expect("worstRealBytes"),
            "{tag}: the worst real bytes diverged"
        );
        assert_eq!(
            ep::unix_alias_scope(data_root),
            vector["scope"].as_str().expect("scope"),
            "{tag}: the alias scope diverged"
        );
        let expected = if branch == "real" {
            real
        } else {
            ep::socket_alias_for(uid, data_root, parent)
        };
        assert_eq!(
            ep::unix_socket_dir(uid, data_root, parent),
            expected,
            "{tag}: the branch diverged ({branch})"
        );
        for (socket_file, endpoint) in vector["endpoints"].as_object().expect("endpoints") {
            assert_eq!(
                ep::unix_endpoint_for(uid, data_root, socket_file, parent),
                endpoint.as_str().expect("endpoint string"),
                "{tag}/{socket_file}: the endpoint diverged"
            );
        }
        // never mixes: every socket of one root, the longest included, is in the branch's one directory
        let longest = ep::longest_socket_file();
        for file in socket_files.iter().copied().chain([longest.as_str()]) {
            assert_eq!(
                ep::unix_endpoint_for(uid, data_root, file, parent),
                format!("{expected}/{file}"),
                "{tag}/{file}: a socket left the root's one directory"
            );
        }
        assert!(
            ep::worst_unix_endpoint(uid, data_root, parent).len() <= ep::SUN_PATH_MAX_BYTES,
            "{tag}: the worst endpoint is over sun_path"
        );
    }
}
