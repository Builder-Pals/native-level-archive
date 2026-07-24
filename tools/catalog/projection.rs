use std::{
    collections::{btree_map::Entry, BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{bail, Result};

use crate::{
    model::{
        ArchiveRecord, Catalog, OrphanMetadata, PlaceIndex, PlaceLookup, Repository, Variant,
        RAW_BASE_URL, SCHEMA_VERSION,
    },
    storage::{json_bytes, load_orphans, load_records, write_bytes},
};

pub const CATALOG_PATH: &str = "catalog-v1.json";
pub const PLACE_INDEX_PATH: &str = "place-index-v1.json";
pub const REVIEW_QUEUE_PATH: &str = "review-queue-v1.json";

pub struct Artifacts {
    pub catalog: Catalog,
    pub place_index: PlaceIndex,
    pub review_queue: Vec<ArchiveRecord>,
}

impl Artifacts {
    pub fn files(&self) -> Result<[(&'static str, Vec<u8>); 3]> {
        Ok([
            (CATALOG_PATH, json_bytes(&self.catalog)?),
            (PLACE_INDEX_PATH, json_bytes(&self.place_index)?),
            (REVIEW_QUEUE_PATH, json_bytes(&self.review_queue)?),
        ])
    }
}

pub fn build(root: &Path) -> Result<()> {
    let artifacts = derive(load_records(root)?, load_orphans(root)?)?;
    for (path, bytes) in artifacts.files()? {
        write_bytes(&root.join(path), &bytes)?;
    }
    eprintln!(
        "built catalog with {} records, {} blobs, and {} indexed places",
        artifacts.catalog.records.len(),
        artifacts.catalog.blobs.len(),
        artifacts.place_index.places.len()
    );
    Ok(())
}

pub fn derive(
    mut records: Vec<ArchiveRecord>,
    mut orphans: Vec<OrphanMetadata>,
) -> Result<Artifacts> {
    records.sort_by(|a, b| a.id.cmp(&b.id));
    orphans.sort_by(|a, b| a.path.cmp(&b.path));

    let mut blobs = BTreeMap::new();
    for record in &records {
        match blobs.entry(record.blob.sha256.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(record.blob.clone());
            }
            Entry::Occupied(entry) if entry.get() != &record.blob => {
                bail!(
                    "records sharing blob {} have inconsistent blob metadata",
                    record.blob.sha256
                );
            }
            Entry::Occupied(_) => {}
        }
    }

    let catalog = Catalog {
        schema_version: SCHEMA_VERSION,
        repository: Repository {
            name: "Builder-Pals/native-level-archive".into(),
            raw_base_url: RAW_BASE_URL.into(),
        },
        blobs,
        records: records.clone(),
        orphan_metadata: orphans,
    };

    let mut grouped: BTreeMap<u64, Vec<&ArchiveRecord>> = BTreeMap::new();
    for record in &records {
        if is_publishable(record) {
            grouped
                .entry(record.source.as_ref().unwrap().root_place_id)
                .or_default()
                .push(record);
        } else if record.preferred {
            bail!("non-publishable record {} cannot be preferred", record.id);
        }
    }

    let mut places = BTreeMap::new();
    for (place_id, mut group) in grouped {
        group.sort_by(|a, b| {
            b.snapshot
                .date
                .cmp(&a.snapshot.date)
                .then_with(|| a.id.cmp(&b.id))
        });
        let universe_ids: BTreeSet<_> = group
            .iter()
            .map(|record| record.source.as_ref().unwrap().universe_id)
            .collect();
        if universe_ids.len() != 1 {
            bail!("place {place_id} has variants from conflicting universes {universe_ids:?}");
        }
        let preferred: Vec<_> = group.iter().filter(|record| record.preferred).collect();
        if preferred.len() != 1 {
            bail!(
                "place {place_id} has {} variants but {} preferred records; curate exactly one",
                group.len(),
                preferred.len()
            );
        }
        places.insert(
            place_id.to_string(),
            PlaceLookup {
                universe_id: *universe_ids.first().unwrap(),
                preferred: Variant::from(*preferred[0]),
                variants: group.into_iter().map(Variant::from).collect(),
            },
        );
    }

    let place_index = PlaceIndex {
        schema_version: SCHEMA_VERSION,
        places,
    };
    let review_queue = records
        .iter()
        .filter(|record| !is_publishable(record))
        .cloned()
        .collect();

    Ok(Artifacts {
        catalog,
        place_index,
        review_queue,
    })
}

pub fn is_publishable(record: &ArchiveRecord) -> bool {
    record.validation.status == "valid"
        && record.source.is_some()
        && ((record.match_info.status == "verified" && record.match_info.confidence == "high")
            || record.match_info.reviewed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        BlobRef, Discovery, MatchInfo, Provenance, RobloxSource, Snapshot, Validation,
    };

    fn record(id: &str, place_id: Option<u64>, universe_id: u64, preferred: bool) -> ArchiveRecord {
        let source = place_id.map(|root_place_id| RobloxSource {
            root_place_id,
            universe_id,
            name: "Example".into(),
            roblox_url: format!("https://www.roblox.com/games/{root_place_id}"),
            description: None,
            creator: None,
            created_at: None,
            updated_at: None,
        });
        ArchiveRecord {
            schema_version: SCHEMA_VERSION,
            id: id.into(),
            title: "Example".into(),
            aliases: Vec::new(),
            snapshot: Snapshot::default(),
            blob: BlobRef {
                sha256: format!("{:0<64}", id),
                path: format!("levels/sha256/aa/{id}.rbxl"),
                format: "binary".into(),
                size_bytes: 1,
                download_url: format!("{RAW_BASE_URL}levels/sha256/aa/{id}.rbxl"),
            },
            validation: Validation {
                status: "valid".into(),
                reason: None,
            },
            provenance: Provenance {
                original_paths: vec!["Example.rbxl".into()],
                collection: "test".into(),
                legacy_metadata_path: None,
                legacy_creator: None,
                notes: None,
            },
            badges: Vec::new(),
            discovery: Discovery::default(),
            source,
            match_info: MatchInfo {
                status: if place_id.is_some() {
                    "verified".into()
                } else {
                    "unresolved".into()
                },
                confidence: if place_id.is_some() {
                    "high".into()
                } else {
                    "none".into()
                },
                reviewed: false,
                evidence: Vec::new(),
            },
            preferred,
        }
    }

    #[test]
    fn derives_runtime_index_and_review_queue() {
        let publishable = record("a", Some(123), 456, true);
        let unresolved = record("b", None, 0, false);
        let artifacts = derive(vec![unresolved, publishable], Vec::new()).unwrap();
        assert_eq!(artifacts.catalog.records.len(), 2);
        assert_eq!(artifacts.place_index.places.len(), 1);
        assert_eq!(artifacts.review_queue.len(), 1);
        assert_eq!(artifacts.place_index.places["123"].preferred.record_id, "a");
    }

    #[test]
    fn rejects_conflicting_universes_for_one_place() {
        let records = vec![
            record("a", Some(123), 456, true),
            record("b", Some(123), 789, false),
        ];
        let error = derive(records, Vec::new()).err().unwrap().to_string();
        assert!(error.contains("conflicting universes"));
    }
}
