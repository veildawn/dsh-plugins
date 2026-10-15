# Test fixtures — certificates for the proxy HTTPS test

These files exist **only** so `test/proxy-https.mjs` can verify that the proxy
transport performs a real TLS handshake with certificate verification enabled.

| File | Purpose |
| --- | --- |
| `ca.pem` | Test CA that the test process trusts via `NODE_EXTRA_CA_CERTS` |
| `server-cert.pem` | Leaf certificate for `api.typesafe.test` (the production hostname) |
| `server-key.pem` | Private key for the leaf certificate |

They are deliberately committed because the test needs a certificate whose SAN
matches `api.typesafe.test`, and generating one at test time would require
`openssl` on every machine and CI runner.

**These are not secrets and must never be trusted outside this test.** The CA is
self-signed, is trusted only inside the spawned test process, and the private key
protects nothing but a throwaway localhost server. Nothing in `lib/` ever
references this directory.

Both certificates are valid 2020-01-01 → 2040-01-01, so the test cannot fail on a
CI runner whose clock is skewed, and does not need regenerating for 15 years.
