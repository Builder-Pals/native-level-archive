# Native Level Archive

A deterministic, indexable archive of historical Roblox places. The repository maps verified
Roblox place IDs to immutable level blobs for Native Legacy and
[`Builder-Pals/nl-web-service`](https://github.com/Builder-Pals/nl-web-service).

## Public data

- [`catalog-v1.json`](catalog-v1.json) is the complete database: 665 logical records, content
  blobs, Roblox metadata, evidence, provenance, unresolved records, and quarantined inputs.
- [`place-index-v1.json`](place-index-v1.json) is the runtime index keyed by decimal Roblox place
  ID. Each entry contains one curated preferred snapshot and every verified variant.
- [`review-queue-v1.json`](review-queue-v1.json) contains records that are unresolved, ambiguous,
  or invalid and therefore cannot be served automatically.

Level payloads live at `levels/sha256/<prefix>/<sha256>.rbxl[x]`. These paths are immutable:
changing the contents at an existing hash path fails verification. Exact duplicate uploads share
one blob while retaining separate catalog records and provenance.

Example lookup:

```sh
jq '.places["14262294"].preferred' place-index-v1.json
```

The returned `download_url` is ready for an HTTP client. Consumers must still verify `sha256` and
enforce their own size limit before parsing the file.

## Catalog workflow

The Rust CLI is intentionally deterministic and keeps network enrichment separate from offline
generation:

```sh
cargo run --release -- import --revision <legacy-revision>
cargo run --release -- discover
cargo run --release -- enrich
cargo run --release -- prefer <record-id>
cargo run --release -- build
cargo run --release -- verify
```

`import` reads Git objects rather than the checked-out filesystem, preserving files whose names
collide on case-insensitive systems. `discover` extracts badge, place, and teleport IDs from the
level contents. `enrich` resolves official Roblox badge/game metadata with bounded concurrency,
retries, and a resumable ignored cache under `catalog/cache`.

Only unanimous curated-sidecar badge evidence, or multiple corroborated embedded badges, is marked
high confidence automatically. Single-badge, conflicting-universe, title-only, and teleport-only
matches remain in the review queue until a maintainer records a review decision. A place with
multiple verified snapshots must have exactly one preferred record before `build` succeeds.

## Contributing

Every record under `catalog/records` preserves its original path and collection. When adding a
place, retain its original title and provenance, run discovery/enrichment, review any proposed
mapping, then regenerate and verify the public artifacts. Never hand-edit generated index entries
or reuse an existing hash path for different bytes.

The two known corrupt source files are preserved under `quarantine/sha256`; quarantined blobs are
included in the complete catalog but excluded from the place index.
