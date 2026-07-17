# Archive editor

This is a dependency-free, offline editor for the archive's source records. It uses the browser's
File System Access API to read and write a repository directory selected by the user. It does not
send files or metadata over the network.

The editor is deployed to
<https://builder-pals.github.io/native-level-archive/> from the `main` branch by GitHub Actions.

## Run it

Use a current Chromium-based browser such as Chrome or Edge. You can first try opening
`web/index.html` directly. If the browser does not make the directory picker available to a local
file, serve this folder from a local-only static server instead:

```powershell
python -m http.server 8000 --directory web
```

Then open <http://localhost:8000>. This server is only used to load the three static front-end
files; the editor remains offline.

Select **Open repository**, choose the `native-level-archive` repository root, and grant read/write
access. The editor verifies the root by looking for `Cargo.toml` and `catalog/records`.

## What it writes

- Editing an entry writes only its `catalog/records/<record-id>.json` source file. The record ID and
  immutable blob reference are protected from changes in the editor.
- **Associate place** provides a guided way to add or correct the selected record's root place ID,
  universe ID, Roblox name, and review evidence. For place IDs already linked elsewhere in the
  repository, the universe ID and name are filled automatically; either value can still be entered
  manually. Unknown place IDs require a manual universe ID because the editor remains offline. The
  form also suggests IDs discovered in the selected place file. It marks the match as manually
  reviewed and verified, generates the canonical Roblox URL, and enforces one preferred snapshot
  per affected place. If the selected
  record replaces another preferred snapshot—or moves away from an old place—the related source
  records are updated together and earlier writes are rolled back if a later write fails. Existing
  match evidence is retained; optional enriched source metadata is retained only while the place
  and universe IDs remain unchanged, so metadata from an old association is not carried over.
- Adding an entry hashes the selected place file in the browser, writes it beneath
  `levels/sha256` (or `quarantine/sha256` when invalid), and creates a new unresolved source record.
  A blob already present at the same content-addressed path is reused after its hash is checked.
- The generated `catalog-v1.json`, `place-index-v1.json`, and `review-queue-v1.json` files are never
  edited directly.

After editing an existing record, regenerate and verify the public data:

```powershell
cargo run --release -- build
cargo run --release -- verify
```

After adding a place, run the full offline/online curation stages as appropriate:

```powershell
cargo run --release -- discover
cargo run --release -- enrich
cargo run --release -- build
cargo run --release -- verify
```

`enrich` is the only stage above that requires network access.
