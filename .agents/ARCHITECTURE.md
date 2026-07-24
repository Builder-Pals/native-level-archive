# Architecture

The Native Level Archive is a data repository with two maintenance tools: a Rust catalog pipeline
and a dependency-free browser editor. Source records and content-addressed place files are the
canonical data. The three JSON files at the repository root are deterministic projections for
consumers.

## Data flow

```text
historical Git objects -> import ----+
place files -----------> discover --+--> catalog/records/*.json
Roblox APIs -----------> enrich ----+             |
browser editor --------> curate ----+             v
                                              projection
                                                  |
                        +-------------------------+-------------------------+
                        v                         v                         v
                  catalog-v1.json       place-index-v1.json      review-queue-v1.json
```

Only `enrich` requires network access. Import reads historical Git objects so paths that collide on
case-insensitive filesystems can still be recovered exactly. Discovery, projection, and verification
are offline.

## Source-of-truth boundaries

- `catalog/records/*.json` contains one source record per recovered archive entry. A record retains
  its provenance even when another record references the same blob.
- `levels/sha256` contains valid place files. `quarantine/sha256` contains preserved invalid files.
  A blob path is derived from its SHA-256 digest and is immutable.
- `catalog/orphan-metadata.json` preserves legacy sidecars that could not be associated safely.
- `catalog-v1.json`, `place-index-v1.json`, and `review-queue-v1.json` are generated and must not be
  edited directly.

The JSON Schema in `catalog/schema/record-v1.schema.json` is the public source-record contract.
Rust models deserialize that contract, while `web/record-utils.js` enforces it before browser writes.
The browser test suite validates every checked-in source record to catch contract drift.

## Catalog modules

- `catalog.rs`: import, discovery, enrichment, and curation commands.
- `git.rs`: byte-safe access to historical Git trees and blobs.
- `level.rs`: Roblox place format inspection.
- `storage.rs`: source-record and JSON filesystem operations.
- `projection.rs`: pure derivation of the public catalog, place index, and review queue.
- `verify.rs`: blob integrity, source inventory, curation invariants, and exact generated-artifact
  verification.
- `model.rs`: serialized schema types.

`build` writes the result of `projection::derive`. `verify` invokes the same derivation and compares
the exact expected bytes with the checked-in artifacts. This ensures a metadata-only source change
cannot leave apparently valid but stale indexes.

## Integrity invariants

- Every record filename matches its record ID.
- Every referenced blob exists, has the recorded size and SHA-256 digest, and is stored at its
  canonical content-addressed path.
- The blob directories contain no unreferenced files.
- Records sharing a digest agree on all blob metadata.
- Only publishable records may be preferred.
- All publishable variants of a place agree on its universe.
- Every indexed place has exactly one preferred variant.
- Generated artifacts are byte-for-byte equal to a fresh deterministic projection.

Historical minimum record counts are intentionally not invariants. Maintainers can add and remove
records through the supported curation workflow; Git history provides the audit trail for those
changes.
