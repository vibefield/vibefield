#!/bin/bash
# SP-4c's rig: makes the TEST identity the host rows serve TLS with, per run (VF-PM 2026-11-13 02:11Z (a): never
# committed). A self-signed P-256 key and certificate for studio.tail1234.ts.net and declared.example (test names;
# never a real one), written ONLY into the run's own work folder, which must be empty and outside any git work tree,
# as a mode-600 PKCS#12 file (`rig.p12`, its passphrase the public constant "rig").
# It writes `rig.env` there with two TEST_RUNNER_ lines that `xcodebuild test` hands the test process (prefix
# stripped): VF_RIG_P12_PATH (the file's absolute path) and VF_RIG_P12_SHA256 (the file's digest). The KEY'S BYTES
# never ride an environment (VF-PM 02:14Z): the test reads the file, checks the digest, and imports it.
# This script removes nothing, and prints counts and the digest's first 16 characters, never the key.
# Usage: make-rig-identity.sh <empty work folder outside the repository>
set -euo pipefail
umask 077
work=${1:?an empty work folder}
[ -d "$work" ] || { echo "no folder: $work"; exit 1; }
work=$(cd "$work" && pwd -P)
[ -z "$(ls -A "$work")" ] || { echo "not empty: $work"; exit 1; }
if git -C "$work" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "inside a git work tree: $work (the key never enters one)"
  exit 1
fi
ssl=/usr/bin/openssl
cat > "$work/rig.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = studio.tail1234.ts.net
[ext]
subjectAltName = DNS:studio.tail1234.ts.net, DNS:declared.example
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
CNF
"$ssl" ecparam -name prime256v1 -out "$work/ec.pem"
"$ssl" req -x509 -newkey "ec:$work/ec.pem" -nodes -keyout "$work/key.pem" -out "$work/cert.pem" -days 825 \
  -config "$work/rig.cnf" 2>/dev/null
"$ssl" pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -out "$work/rig.p12" -passout pass:rig
chmod 600 "$work/rig.p12" "$work/key.pem"
digest=$(shasum -a 256 "$work/rig.p12" | cut -c1-64)
printf 'TEST_RUNNER_VF_RIG_P12_PATH=%s\nTEST_RUNNER_VF_RIG_P12_SHA256=%s\n' "$work/rig.p12" "$digest" > "$work/rig.env"
echo "rig identity: p12 bytes $(wc -c < "$work/rig.p12" | tr -d ' '), p12 sha256 ${digest:0:16}, rig.env lines 2"
