use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::model::{ArchiveRecord, OrphanMetadata};

pub const RECORDS_DIR: &str = "catalog/records";
pub const ORPHANS_PATH: &str = "catalog/orphan-metadata.json";

pub fn load_records(root: &Path) -> Result<Vec<ArchiveRecord>> {
    let directory = root.join(RECORDS_DIR);
    if !directory.exists() {
        bail!("{} does not exist; run import first", directory.display());
    }
    let mut paths: Vec<_> = fs::read_dir(directory)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let record: ArchiveRecord = serde_json::from_slice(&fs::read(&path)?)
                .with_context(|| format!("invalid record {}", path.display()))?;
            let filename_id = path.file_stem().and_then(|value| value.to_str());
            if filename_id != Some(record.id.as_str()) {
                bail!(
                    "record filename {} does not match ID {}",
                    path.display(),
                    record.id
                );
            }
            Ok(record)
        })
        .collect()
}

pub fn load_orphans(root: &Path) -> Result<Vec<OrphanMetadata>> {
    let path = root.join(ORPHANS_PATH);
    if path.exists() {
        serde_json::from_slice(&fs::read(&path)?)
            .with_context(|| format!("invalid orphan metadata {}", path.display()))
    } else {
        Ok(Vec::new())
    }
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_bytes(path, &json_bytes(value)?)
}

pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes).with_context(|| format!("failed to write {}", path.display()))
}

pub fn json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn record_path(root: &Path, id: &str) -> PathBuf {
    root.join(RECORDS_DIR).join(format!("{id}.json"))
}

pub fn walk_files(root: PathBuf) -> Vec<PathBuf> {
    let mut output = Vec::new();
    let mut pending = vec![root];
    while let Some(path) = pending.pop() {
        let Ok(entries) = fs::read_dir(path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                output.push(path);
            }
        }
    }
    output
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
