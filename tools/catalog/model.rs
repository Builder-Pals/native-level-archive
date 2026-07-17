use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const RAW_BASE_URL: &str =
    "https://raw.githubusercontent.com/Builder-Pals/native-level-archive/main/";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ArchiveRecord {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub snapshot: Snapshot,
    pub blob: BlobRef,
    pub validation: Validation,
    pub provenance: Provenance,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<BadgeRef>,
    #[serde(default)]
    pub discovery: Discovery,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RobloxSource>,
    #[serde(rename = "match", default)]
    pub match_info: MatchInfo,
    #[serde(default)]
    pub preferred: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Snapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub precision: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct BlobRef {
    pub sha256: String,
    pub path: String,
    pub format: String,
    pub size_bytes: u64,
    pub download_url: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Validation {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Provenance {
    pub original_paths: Vec<String>,
    pub collection: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_metadata_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BadgeRef {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub origin: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Discovery {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badge_ids: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub place_ids: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub teleport_place_ids: Vec<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RobloxSource {
    pub root_place_id: u64,
    pub universe_id: u64,
    pub name: String,
    pub roblox_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<Creator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Creator {
    pub id: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MatchInfo {
    pub status: String,
    pub confidence: String,
    #[serde(default)]
    pub reviewed: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<Evidence>,
}

impl Default for MatchInfo {
    fn default() -> Self {
        Self {
            status: "unresolved".into(),
            confidence: "none".into(),
            reviewed: false,
            evidence: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Evidence {
    pub kind: String,
    pub value: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OrphanMetadata {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(default)]
    pub badges: Vec<BadgeRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Catalog {
    pub schema_version: u32,
    pub repository: Repository,
    pub blobs: BTreeMap<String, BlobRef>,
    pub records: Vec<ArchiveRecord>,
    pub orphan_metadata: Vec<OrphanMetadata>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Repository {
    pub name: String,
    pub raw_base_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaceIndex {
    pub schema_version: u32,
    pub places: BTreeMap<String, PlaceLookup>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaceLookup {
    pub universe_id: u64,
    pub preferred: Variant,
    pub variants: Vec<Variant>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Variant {
    pub record_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_date: Option<String>,
    pub sha256: String,
    pub size_bytes: u64,
    pub path: String,
    pub download_url: String,
}

impl From<&ArchiveRecord> for Variant {
    fn from(record: &ArchiveRecord) -> Self {
        Self {
            record_id: record.id.clone(),
            title: record.title.clone(),
            snapshot_date: record.snapshot.date.clone(),
            sha256: record.blob.sha256.clone(),
            size_bytes: record.blob.size_bytes,
            path: record.blob.path.clone(),
            download_url: record.blob.download_url.clone(),
        }
    }
}
