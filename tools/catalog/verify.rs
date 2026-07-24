use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use anyhow::{bail, Context, Result};

use crate::{
    level,
    model::{ArchiveRecord, SCHEMA_VERSION},
    projection,
    storage::{load_orphans, load_records, sha256_hex, walk_files},
};

pub fn verify(root: &Path) -> Result<()> {
    let records = load_records(root)?;
    if records.is_empty() {
        bail!("catalog contains no source records");
    }

    let mut hashes: BTreeMap<&str, usize> = BTreeMap::new();
    let mut invalid = 0;
    let mut record_ids = BTreeSet::new();
    let mut referenced_paths = BTreeSet::new();
    for record in &records {
        let id_suffix = record.id.strip_prefix("nla_").unwrap_or_default();
        if id_suffix.len() != 32 || !is_lower_hex(id_suffix) {
            bail!("record {} has a non-canonical ID", record.id);
        }
        if record.schema_version != SCHEMA_VERSION {
            bail!("record {} has unsupported schema version", record.id);
        }
        if !record_ids.insert(record.id.as_str()) {
            bail!("duplicate record ID {}", record.id);
        }
        *hashes.entry(&record.blob.sha256).or_default() += 1;
        referenced_paths.insert(record.blob.path.replace('\\', "/"));
        if record.validation.status != "valid" {
            invalid += 1;
        }
        verify_blob(root, record)?;
    }

    let on_disk: BTreeSet<_> = [root.join("levels"), root.join("quarantine")]
        .into_iter()
        .filter(|path| path.exists())
        .flat_map(walk_files)
        .map(|path| {
            path.strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    if on_disk != referenced_paths {
        let unreferenced: Vec<_> = on_disk.difference(&referenced_paths).collect();
        let missing: Vec<_> = referenced_paths.difference(&on_disk).collect();
        bail!("blob inventory mismatch; unreferenced={unreferenced:?}, missing={missing:?}");
    }

    let artifacts = projection::derive(records.clone(), load_orphans(root)?)?;
    for (relative_path, expected) in artifacts.files()? {
        verify_generated_artifact(root, relative_path, &expected)?;
    }

    let duplicate_groups = hashes.values().filter(|count| **count > 1).count();
    eprintln!(
        "verified {} records, {} unique blobs, {} duplicate groups, {} invalid records, and 3 generated artifacts",
        records.len(),
        hashes.len(),
        duplicate_groups,
        invalid
    );
    Ok(())
}

fn verify_generated_artifact(root: &Path, relative_path: &str, expected: &[u8]) -> Result<()> {
    let path = root.join(relative_path);
    let actual = fs::read(&path)
        .with_context(|| format!("missing generated artifact {}; run build", path.display()))?;
    if actual != expected {
        bail!("{relative_path} is stale; run build");
    }
    Ok(())
}

fn verify_blob(root: &Path, record: &ArchiveRecord) -> Result<()> {
    if record.blob.path.contains("..") || Path::new(&record.blob.path).is_absolute() {
        bail!("record {} has an unsafe blob path", record.id);
    }
    if record.blob.sha256.len() != 64 || !is_lower_hex(&record.blob.sha256) {
        bail!("record {} has an invalid blob digest", record.id);
    }
    let (base, extension) = match (
        record.validation.status.as_str(),
        record.blob.format.as_str(),
    ) {
        ("valid", "xml") => ("levels", "rbxlx"),
        ("valid", "binary") => ("levels", "rbxl"),
        ("invalid", "invalid") => ("quarantine", "bin"),
        _ => bail!(
            "record {} has an inconsistent validation status and blob format",
            record.id
        ),
    };
    let expected_path = format!(
        "{base}/sha256/{}/{}.{}",
        &record.blob.sha256[..2],
        record.blob.sha256,
        extension
    );
    if record.blob.path != expected_path {
        bail!(
            "record {} blob path is not content-addressed; expected {expected_path}",
            record.id
        );
    }
    let path = root.join(&record.blob.path);
    let bytes = fs::read(&path).with_context(|| format!("missing blob {}", path.display()))?;
    if bytes.len() as u64 != record.blob.size_bytes {
        bail!("size mismatch for {}", record.blob.path);
    }
    if sha256_hex(&bytes) != record.blob.sha256 {
        bail!("SHA-256 mismatch for {}", record.blob.path);
    }
    let (format, validation) = level::inspect(&bytes);
    if format != record.blob.format || validation.status != record.validation.status {
        bail!("format/validation mismatch for {}", record.blob.path);
    }
    if record.blob.download_url != format!("{}{}", crate::model::RAW_BASE_URL, record.blob.path) {
        bail!("download URL mismatch for {}", record.id);
    }
    Ok(())
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn rejects_stale_generated_artifact() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "native-level-archive-verify-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("catalog-v1.json"), b"stale\n").unwrap();

        let error = verify_generated_artifact(&root, "catalog-v1.json", b"expected\n")
            .err()
            .unwrap()
            .to_string();

        fs::remove_dir_all(root).unwrap();
        assert_eq!(error, "catalog-v1.json is stale; run build");
    }
}
