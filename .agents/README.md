# native-level-archive

An archive of old Roblox places, built to work with [`Builder-Pals/nl-web-service`](https://github.com/Builder-Pals/nl-web-service).

## Public data

* [`catalog-v1.json`](catalog-v1.json) is the complete catalog. It contains more than 600 records, along with content blobs, Roblox metadata, provenance, unresolved matches, and quarantined files.
* [`place-index-v1.json`](place-index-v1.json) is the runtime index, keyed by decimal Roblox place ID. Each place has one preferred snapshot and any other verified versions we have found.
* [`review-queue-v1.json`](review-queue-v1.json) contains records that could not be matched safely, including ambiguous, unresolved, and invalid entries.

Place files are stored under:

```text
levels/sha256/<prefix>/<sha256>.rbxl[x]
```

These paths are content-addressed and immutable. Two identical files share the same blob, while their individual catalog records and provenance are kept separately. Replacing the contents of an existing hash path will cause verification to fail.

Example lookup:

```sh
jq '.places["14262294"].preferred' place-index-v1.json
```

The returned `download_url` can be passed directly to an HTTP client. Consumers should still verify the file's `sha256` and apply their own size limit before parsing it.

## Catalog workflow

The archive is managed using a deterministic Rust CLI. Network-dependent metadata collection is kept separate from offline generation:

```sh
cargo run --release -- import --revision <legacy-revision>
cargo run --release -- discover
cargo run --release -- enrich
cargo run --release -- prefer <record-id>
cargo run --release -- build
cargo run --release -- verify
```

`import` reads files directly from Git objects rather than the checked-out filesystem. This allows it to preserve files whose names would collide on case-insensitive systems.

`discover` scans place contents for badge IDs, place IDs, and teleport destinations.

`enrich` looks up official Roblox badge and game metadata. Requests use bounded concurrency and retries, with resumable cache data stored under `catalog/cache`.

Automatic matches are deliberately conservative. A record is only marked as high confidence when:

* curated sidecar badge evidence agrees unanimously; or
* multiple embedded badges point to the same place.

Single-badge matches, conflicting universes, title-only matches, and teleport-only matches stay in the review queue until a maintainer makes a decision.

When a place has multiple verified snapshots, one record must be selected as preferred before `build` will succeed.

## Contributing

Records under `catalog/records` keep their original filename, path, and source collection.

When adding a place:

1. Preserve its original title and provenance.
2. Run discovery and enrichment.
3. Review any proposed place mapping.
4. Rebuild and verify the public files.

Generated index entries shouldn't be modified directly! Do not reuse an existing hash paths for different file contents.

Two known corrupt source files are preserved under `quarantine/sha256`. They remain visible in the complete catalog, but are excluded from the place index.
