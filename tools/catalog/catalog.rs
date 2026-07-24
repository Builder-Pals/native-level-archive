use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::Path,
    time::Duration,
};

use anyhow::{bail, Context, Result};
use chrono::NaiveDate;
use futures_util::{stream, StreamExt};
use regex::Regex;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tokio::time::sleep;

use crate::{
    git, level,
    model::{
        ArchiveRecord, BadgeRef, BlobRef, Creator, Discovery, Evidence, MatchInfo, OrphanMetadata,
        Provenance, RobloxSource, Snapshot, RAW_BASE_URL, SCHEMA_VERSION,
    },
    storage::{load_records, record_path, sha256_hex, write_json, ORPHANS_PATH},
    verify,
};

const LEGACY_RECORDS: usize = 665;

#[derive(Clone, Debug)]
struct LegacyMetadata {
    path: String,
    creator: Option<String>,
    badges: Vec<BadgeRef>,
}

#[derive(Debug, Deserialize)]
struct LegacyMetadataWire {
    #[serde(rename = "Creator")]
    creator: Option<String>,
    #[serde(rename = "Badges", default)]
    badges: Vec<LegacyBadgeWire>,
}

#[derive(Debug, Deserialize)]
struct LegacyBadgeWire {
    #[serde(rename = "ID")]
    #[serde(deserialize_with = "deserialize_u64")]
    id: u64,
    #[serde(rename = "Name")]
    name: Option<String>,
}

fn deserialize_u64<'de, D>(deserializer: D) -> std::result::Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Number {
        Integer(u64),
        Text(String),
    }
    match Number::deserialize(deserializer)? {
        Number::Integer(value) => Ok(value),
        Number::Text(value) => value.parse().map_err(serde::de::Error::custom),
    }
}

pub fn import(root: &Path, revision: &str) -> Result<()> {
    let entries = git::list_tree(root, revision)?;
    let legacy = load_legacy_metadata(root, &entries)?;
    let mut used_metadata = BTreeSet::new();
    let mut records = Vec::new();

    let level_entries: Vec<_> = entries
        .iter()
        .filter(|entry| is_level_path(&entry.path))
        .collect();
    if level_entries.len() != LEGACY_RECORDS {
        bail!(
            "expected {LEGACY_RECORDS} tracked levels, found {}",
            level_entries.len()
        );
    }

    for (index, entry) in level_entries.iter().enumerate() {
        let bytes = git::read_blob(root, &entry.oid)?;
        if bytes.len() as u64 != entry.size {
            bail!("Git reported the wrong size for {}", entry.path);
        }
        let sha256 = sha256_hex(&bytes);
        let (format, validation) = level::inspect(&bytes);
        let extension = match format.as_str() {
            "xml" => "rbxlx",
            "binary" => "rbxl",
            _ => "bin",
        };
        let base = if validation.status == "valid" {
            "levels/sha256"
        } else {
            "quarantine/sha256"
        };
        let relative_path = format!("{base}/{}/{sha256}.{extension}", &sha256[..2]);
        let destination = root.join(&relative_path);
        write_blob_once(&destination, &bytes, &sha256)?;

        let title = level_title(&entry.path);
        let metadata_key = find_metadata_key(&entry.path, &legacy);
        let metadata = metadata_key.as_ref().and_then(|key| legacy.get(key));
        if let Some(key) = metadata_key {
            used_metadata.insert(key);
        }
        let snapshot = parse_snapshot(&title);
        let id = format!(
            "nla_{}",
            &sha256_hex(format!("record-v1\0{}", entry.path).as_bytes())[..32]
        );
        let record = ArchiveRecord {
            schema_version: SCHEMA_VERSION,
            id,
            title,
            aliases: Vec::new(),
            snapshot,
            blob: BlobRef {
                sha256: sha256.clone(),
                path: relative_path.clone(),
                format,
                size_bytes: bytes.len() as u64,
                download_url: format!("{RAW_BASE_URL}{relative_path}"),
            },
            validation,
            provenance: Provenance {
                original_paths: vec![entry.path.clone()],
                collection: collection_name(&entry.path),
                legacy_metadata_path: metadata.map(|item| item.path.clone()),
                legacy_creator: metadata.and_then(|item| item.creator.clone()),
                notes: None,
            },
            badges: metadata.map(|item| item.badges.clone()).unwrap_or_default(),
            discovery: Discovery::default(),
            source: None,
            match_info: MatchInfo::default(),
            preferred: false,
        };
        write_json(&record_path(root, &record.id), &record)?;
        records.push(record);

        if (index + 1) % 50 == 0 || index + 1 == level_entries.len() {
            eprintln!("imported {}/{} records", index + 1, level_entries.len());
        }
    }

    let mut orphans = Vec::new();
    for (key, item) in legacy {
        if !used_metadata.contains(&key) {
            orphans.push(OrphanMetadata {
                path: item.path,
                creator: item.creator,
                badges: item.badges,
            });
        }
    }
    orphans.sort_by(|a, b| a.path.cmp(&b.path));
    write_json(&root.join(ORPHANS_PATH), &orphans)?;
    eprintln!(
        "import complete: {} records, {} orphan metadata files",
        records.len(),
        orphans.len()
    );
    Ok(())
}

pub fn clean_legacy(root: &Path, revision: &str, apply: bool) -> Result<()> {
    verify::verify(root)?;
    let entries = git::list_tree(root, revision)?;
    let targets: Vec<_> = entries
        .iter()
        .filter(|entry| is_level_path(&entry.path) || is_legacy_metadata(&entry.path))
        .collect();
    for entry in &targets {
        let relative = Path::new(&entry.path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            bail!("unsafe legacy path {}", entry.path);
        }
    }
    if !apply {
        eprintln!(
            "would remove {} tracked legacy paths; rerun with --apply",
            targets.len()
        );
        return Ok(());
    }
    let mut removed = 0;
    for entry in targets {
        let path = root.join(&entry.path);
        if path.is_file() {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove legacy path {}", path.display()))?;
            removed += 1;
        }
    }
    eprintln!("removed {removed} checked-out legacy paths");
    Ok(())
}

pub fn restore_blobs(root: &Path, revision: &str, apply: bool) -> Result<()> {
    let entries: HashMap<_, _> = git::list_tree(root, revision)?
        .into_iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let records = load_records(root)?;
    let mut checked = BTreeSet::new();
    let mut repairs = Vec::new();

    for record in &records {
        if !checked.insert(record.blob.path.clone()) {
            continue;
        }
        if record.blob.path.contains("..") || Path::new(&record.blob.path).is_absolute() {
            bail!("record {} has an unsafe blob path", record.id);
        }
        let path = root.join(&record.blob.path);
        let current =
            fs::read(&path).with_context(|| format!("missing blob {}", path.display()))?;
        if current.len() as u64 == record.blob.size_bytes
            && sha256_hex(&current) == record.blob.sha256
        {
            continue;
        }

        let mut replacement = None;
        for original_path in &record.provenance.original_paths {
            let Some(entry) = entries.get(original_path) else {
                continue;
            };
            let bytes = git::read_blob(root, &entry.oid)?;
            if bytes.len() as u64 == record.blob.size_bytes
                && sha256_hex(&bytes) == record.blob.sha256
            {
                replacement = Some(bytes);
                break;
            }
        }
        let bytes = replacement.with_context(|| {
            format!(
                "no historical blob in {revision} matches {}",
                record.blob.path
            )
        })?;
        repairs.push((path, bytes));
    }

    if !apply {
        eprintln!(
            "would restore {} blobs from {revision}; rerun with --apply",
            repairs.len()
        );
        return Ok(());
    }
    let repair_count = repairs.len();
    for (path, bytes) in repairs {
        fs::write(&path, bytes).with_context(|| format!("failed to restore {}", path.display()))?;
    }
    eprintln!("restored {repair_count} blobs from {revision}");
    Ok(())
}

fn load_legacy_metadata(
    root: &Path,
    entries: &[git::TreeEntry],
) -> Result<BTreeMap<String, LegacyMetadata>> {
    let mut result = BTreeMap::new();
    for entry in entries
        .iter()
        .filter(|entry| is_legacy_metadata(&entry.path))
    {
        let bytes = git::read_blob(root, &entry.oid)?;
        let wire: LegacyMetadataWire = serde_json::from_slice(&bytes)
            .with_context(|| format!("invalid legacy metadata {}", entry.path))?;
        let key = metadata_stem(&entry.path).to_lowercase();
        result.insert(
            key,
            LegacyMetadata {
                path: entry.path.clone(),
                creator: wire.creator,
                badges: wire
                    .badges
                    .into_iter()
                    .map(|badge| BadgeRef {
                        id: badge.id,
                        name: badge.name,
                        origin: "legacy_sidecar".into(),
                    })
                    .collect(),
            },
        );
    }
    Ok(result)
}

fn find_metadata_key(
    level_path: &str,
    metadata: &BTreeMap<String, LegacyMetadata>,
) -> Option<String> {
    let exact = level_title(level_path).to_lowercase();
    if metadata.contains_key(&exact) {
        return Some(exact);
    }
    let normalized = normalize_title(&exact);
    let matches: Vec<_> = metadata
        .keys()
        .filter(|key| normalize_title(key) == normalized)
        .cloned()
        .collect();
    (matches.len() == 1).then(|| matches[0].clone())
}

fn write_blob_once(path: &Path, bytes: &[u8], sha256: &str) -> Result<()> {
    if path.exists() {
        let existing = fs::read(path)?;
        if sha256_hex(&existing) != sha256 {
            bail!("refusing to overwrite mismatched blob {}", path.display());
        }
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes).with_context(|| format!("failed to write {}", path.display()))
}

pub fn discover(root: &Path) -> Result<()> {
    let mut records = load_records(root)?;
    let total_records = records.len();
    let structural_badge = Regex::new(
        r#"(?is)<string\s+name="Name">[^<]*badge[^<]*</string>.{0,320}?<(?:int|int64|string|double)\s+name="Value">\s*(\d{5,18})"#,
    )?;
    let script_badge = Regex::new(
        r#"(?is)(?:AwardBadge|UserHasBadge(?:Async)?|BadgeI[Dd])[^0-9]{0,100}(\d{5,18})"#,
    )?;
    let place_url = Regex::new(r#"(?i)roblox\.com/(?:games|places)/(\d{1,18})"#)?;
    let place_compare = Regex::new(r#"(?i)(?:game\.)?PlaceId\s*(?:==|~=)\s*(\d{1,18})"#)?;
    let teleport =
        Regex::new(r#"(?i)Teleport(?:Async|PartyAsync|ToPlaceInstance)?\s*\(\s*(\d{1,18})"#)?;

    for (index, record) in records.iter_mut().enumerate() {
        if record.validation.status != "valid" || record.blob.format != "xml" {
            continue;
        }
        let text = fs::read_to_string(root.join(&record.blob.path))
            .with_context(|| format!("failed to read {}", record.blob.path))?;
        let mut badge_ids = capture_ids(&text, &structural_badge);
        badge_ids.extend(capture_ids(&text, &script_badge));
        badge_ids.sort_unstable();
        badge_ids.dedup();
        let mut place_ids = capture_ids(&text, &place_url);
        place_ids.extend(capture_ids(&text, &place_compare));
        place_ids.sort_unstable();
        place_ids.dedup();
        let mut teleport_ids = capture_ids(&text, &teleport);
        teleport_ids.sort_unstable();
        teleport_ids.dedup();

        for id in &badge_ids {
            if !record.badges.iter().any(|badge| badge.id == *id) {
                record.badges.push(BadgeRef {
                    id: *id,
                    name: None,
                    origin: "embedded".into(),
                });
            }
        }
        record.badges.sort_by_key(|badge| badge.id);
        record.badges.dedup_by_key(|badge| badge.id);
        record.discovery = Discovery {
            badge_ids,
            place_ids,
            teleport_place_ids: teleport_ids,
        };
        write_json(&record_path(root, &record.id), record)?;
        if (index + 1) % 50 == 0 {
            eprintln!(
                "discovered evidence in {}/{} records",
                index + 1,
                total_records
            );
        }
    }
    Ok(())
}

fn capture_ids(text: &str, regex: &Regex) -> Vec<u64> {
    regex
        .captures_iter(text)
        .filter_map(|capture| capture.get(1)?.as_str().parse().ok())
        .filter(|id| *id != 0)
        .collect()
}

#[derive(Clone, Debug, Deserialize)]
struct BadgeApi {
    id: u64,
    name: String,
    #[serde(rename = "awardingUniverse")]
    awarding_universe: BadgeUniverse,
}

#[derive(Clone, Debug, Deserialize)]
struct BadgeUniverse {
    id: u64,
    name: String,
    #[serde(rename = "rootPlaceId")]
    root_place_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
struct GamesResponse {
    data: Vec<GameApi>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
struct GameApi {
    id: u64,
    #[serde(rename = "rootPlaceId")]
    root_place_id: u64,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    creator: Option<GameCreatorApi>,
    #[serde(default)]
    created: Option<String>,
    #[serde(default)]
    updated: Option<String>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
struct GameCreatorApi {
    id: u64,
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

pub async fn enrich(root: &Path) -> Result<()> {
    let mut records = load_records(root)?;
    let badge_ids: BTreeSet<_> = records
        .iter()
        .flat_map(|record| record.badges.iter().map(|badge| badge.id))
        .collect();
    let client = Client::builder()
        .user_agent("Builder-Pals/native-level-archive catalog-v1")
        .timeout(Duration::from_secs(20))
        .build()?;

    fs::create_dir_all(root.join("catalog/cache/badges"))?;
    fs::create_dir_all(root.join("catalog/cache/games"))?;
    let badge_results = stream::iter(badge_ids.into_iter().map(|id| {
        let client = client.clone();
        async move { (id, fetch_badge(root, &client, id).await) }
    }))
    .buffer_unordered(8)
    .collect::<Vec<_>>()
    .await;
    let mut badges = BTreeMap::new();
    for (id, result) in badge_results {
        match result {
            Ok(Some(badge)) => {
                badges.insert(id, badge);
            }
            Ok(None) => eprintln!("badge {id} is unavailable"),
            Err(error) => eprintln!("badge {id} enrichment failed: {error:#}"),
        }
    }

    let mut mapped_universes = BTreeSet::new();
    for record in &mut records {
        let mut resolved = Vec::new();
        for badge in &mut record.badges {
            if let Some(api) = badges.get(&badge.id) {
                if badge.name.is_none() {
                    badge.name = Some(api.name.clone());
                }
                resolved.push((badge.origin.as_str(), api));
            }
        }
        let roots: BTreeSet<_> = resolved
            .iter()
            .map(|(_, badge)| {
                (
                    badge.awarding_universe.id,
                    badge.awarding_universe.root_place_id,
                )
            })
            .collect();
        if roots.len() > 1 {
            record.match_info = MatchInfo {
                status: "conflict".into(),
                confidence: "none".into(),
                reviewed: false,
                evidence: resolved
                    .iter()
                    .map(|(_, badge)| badge_evidence(badge))
                    .collect(),
            };
            record.source = None;
            record.preferred = false;
            continue;
        }
        let Some((universe_id, root_place_id)) = roots.first().copied() else {
            continue;
        };
        let sidecar_count = resolved
            .iter()
            .filter(|(origin, _)| *origin == "legacy_sidecar")
            .count();
        let embedded_count = resolved
            .iter()
            .filter(|(origin, _)| *origin == "embedded")
            .count();
        let universe_name = &resolved[0].1.awarding_universe.name;
        let strong = sidecar_count > 0
            || (embedded_count >= 2 && titles_correspond(&record.title, universe_name));
        if strong {
            record.source = Some(RobloxSource {
                root_place_id,
                universe_id,
                name: universe_name.clone(),
                roblox_url: format!("https://www.roblox.com/games/{root_place_id}"),
                description: None,
                creator: None,
                created_at: None,
                updated_at: None,
            });
            record.match_info = MatchInfo {
                status: "verified".into(),
                confidence: "high".into(),
                reviewed: false,
                evidence: resolved
                    .iter()
                    .map(|(_, badge)| badge_evidence(badge))
                    .collect(),
            };
            mapped_universes.insert(universe_id);
        } else {
            record.match_info = MatchInfo {
                status: "candidate".into(),
                confidence: "medium".into(),
                reviewed: false,
                evidence: resolved
                    .iter()
                    .map(|(_, badge)| badge_evidence(badge))
                    .collect(),
            };
        }
    }

    let games = fetch_games(root, &client, &mapped_universes).await?;
    for record in &mut records {
        if let Some(source) = &mut record.source {
            if let Some(game) = games.get(&source.universe_id) {
                source.root_place_id = game.root_place_id;
                source.name = game.name.clone();
                source.roblox_url = format!("https://www.roblox.com/games/{}", game.root_place_id);
                source.description = game.description.clone().filter(|value| !value.is_empty());
                source.creator = game.creator.as_ref().map(|creator| Creator {
                    id: creator.id,
                    name: creator.name.clone(),
                    kind: creator.kind.clone(),
                });
                source.created_at = game.created.clone();
                source.updated_at = game.updated.clone();
            }
        }
    }

    let mut by_place: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
    for (index, record) in records.iter().enumerate() {
        if record.match_info.status == "verified" {
            if let Some(source) = &record.source {
                by_place
                    .entry(source.root_place_id)
                    .or_default()
                    .push(index);
            }
        }
    }
    for indexes in by_place.values() {
        if indexes.len() == 1 {
            records[indexes[0]].preferred = true;
        }
    }
    for record in &records {
        write_json(&record_path(root, &record.id), record)?;
    }
    eprintln!(
        "enriched {} badge responses and {} verified records",
        badges.len(),
        records
            .iter()
            .filter(|record| record.match_info.status == "verified")
            .count()
    );
    Ok(())
}

fn badge_evidence(badge: &BadgeApi) -> Evidence {
    Evidence {
        kind: "badge".into(),
        value: badge.id.to_string(),
        detail: format!(
            "badge resolves to universe {} and root place {}",
            badge.awarding_universe.id, badge.awarding_universe.root_place_id
        ),
    }
}

async fn fetch_badge(root: &Path, client: &Client, id: u64) -> Result<Option<BadgeApi>> {
    let cache = root.join(format!("catalog/cache/badges/{id}.json"));
    if cache.exists() {
        return Ok(Some(serde_json::from_slice(&fs::read(cache)?)?));
    }
    let url = format!("https://badges.roblox.com/v1/badges/{id}");
    for attempt in 0..5 {
        let response = client.get(&url).send().await;
        match response {
            Ok(response) if response.status().is_success() => {
                let bytes = response.bytes().await?;
                let badge: BadgeApi = serde_json::from_slice(&bytes)?;
                fs::write(&cache, &bytes)?;
                return Ok(Some(badge));
            }
            Ok(response) if response.status() == StatusCode::NOT_FOUND => return Ok(None),
            Ok(response)
                if response.status() == StatusCode::TOO_MANY_REQUESTS
                    || response.status().is_server_error() => {}
            Ok(response) => bail!("badge API returned {} for {id}", response.status()),
            Err(error) if attempt == 4 => return Err(error.into()),
            Err(_) => {}
        }
        sleep(Duration::from_millis(250 * (1 << attempt))).await;
    }
    bail!("badge API retry budget exhausted for {id}")
}

async fn fetch_games(
    root: &Path,
    client: &Client,
    universe_ids: &BTreeSet<u64>,
) -> Result<BTreeMap<u64, GameApi>> {
    let mut games = BTreeMap::new();
    let mut missing = Vec::new();
    for id in universe_ids {
        let cache = root.join(format!("catalog/cache/games/{id}.json"));
        if cache.exists() {
            let game: GameApi = serde_json::from_slice(&fs::read(cache)?)?;
            games.insert(*id, game);
        } else {
            missing.push(*id);
        }
    }
    for chunk in missing.chunks(50) {
        let ids = chunk
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let url = format!("https://games.roblox.com/v1/games?universeIds={ids}");
        let response = client.get(url).send().await?.error_for_status()?;
        let response: GamesResponse = response.json().await?;
        for game in response.data {
            write_json(
                &root.join(format!("catalog/cache/games/{}.json", game.id)),
                &game,
            )?;
            games.insert(game.id, game);
        }
    }
    Ok(games)
}

pub fn prefer(root: &Path, record_id: &str) -> Result<()> {
    let mut records = load_records(root)?;
    let target = records
        .iter()
        .find(|record| record.id == record_id)
        .context("preferred record ID was not found")?;
    if target.validation.status != "valid" || target.match_info.status != "verified" {
        bail!("preferred record must be valid and verified");
    }
    let place_id = target
        .source
        .as_ref()
        .context("preferred record has no Roblox source")?
        .root_place_id;
    for record in &mut records {
        if record.source.as_ref().map(|source| source.root_place_id) == Some(place_id) {
            record.preferred = record.id == record_id;
            write_json(&record_path(root, &record.id), record)?;
        }
    }
    eprintln!("preferred {record_id} for place {place_id}");
    Ok(())
}

fn is_level_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    (lower.ends_with(".rbxl") || lower.ends_with(".rbxlx"))
        && !lower.starts_with("levels/")
        && !lower.starts_with("quarantine/")
}

fn is_legacy_metadata(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    !path.contains('/') && (lower.ends_with(".meta.json") || lower.ends_with(".json"))
}

fn metadata_stem(path: &str) -> String {
    let filename = path.rsplit('/').next().unwrap_or(path);
    filename
        .strip_suffix(".meta.json")
        .or_else(|| filename.strip_suffix(".json"))
        .unwrap_or(filename)
        .into()
}

fn level_title(path: &str) -> String {
    let filename = path.rsplit('/').next().unwrap_or(path);
    filename
        .strip_suffix(".rbxlx")
        .or_else(|| filename.strip_suffix(".rbxl"))
        .unwrap_or(filename)
        .into()
}

fn collection_name(path: &str) -> String {
    path.split_once('/')
        .map(|(collection, _)| collection.to_string())
        .unwrap_or_else(|| "root".into())
}

fn normalize_title(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn titles_correspond(left: &str, right: &str) -> bool {
    let left = normalize_title(left);
    let right = normalize_title(right);
    left.len() >= 4 && right.len() >= 4 && (left.contains(&right) || right.contains(&left))
}

fn parse_snapshot(title: &str) -> Snapshot {
    let label = Regex::new(r"\(([^()]*)\)")
        .unwrap()
        .captures_iter(title)
        .last()
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().trim().to_string());
    let months = [
        ("january", 1),
        ("february", 2),
        ("march", 3),
        ("april", 4),
        ("may", 5),
        ("june", 6),
        ("july", 7),
        ("august", 8),
        ("september", 9),
        ("october", 10),
        ("november", 11),
        ("december", 12),
    ];
    let month_map: HashMap<_, _> = months.into_iter().collect();
    let full = Regex::new(
        r"(?i)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})",
    )
    .unwrap();
    if let Some(capture) = full.captures(title) {
        let month = month_map[&capture[1].to_ascii_lowercase().as_str()];
        let day: u32 = capture[2].parse().unwrap_or(1);
        let year: i32 = capture[3].parse().unwrap_or(0);
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            return Snapshot {
                label,
                date: Some(date.format("%Y-%m-%d").to_string()),
                precision: Some("day".into()),
            };
        }
    }
    let month_year = Regex::new(
        r"(?i)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})",
    )
    .unwrap();
    if let Some(capture) = month_year.captures(title) {
        let month = month_map[&capture[1].to_ascii_lowercase().as_str()];
        let year: i32 = capture[2].parse().unwrap_or(0);
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, 1) {
            return Snapshot {
                label,
                date: Some(date.format("%Y-%m-%d").to_string()),
                precision: Some("month".into()),
            };
        }
    }
    let year = Regex::new(r"(?:^|[^0-9])(200[6-9]|201[0-9]|202[0-3])(?:[^0-9]|$)").unwrap();
    if let Some(capture) = year.captures(title) {
        return Snapshot {
            label,
            date: Some(format!("{}-01-01", &capture[1])),
            precision: Some("year".into()),
        };
    }
    Snapshot {
        label,
        date: None,
        precision: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_snapshot_precision() {
        let day = parse_snapshot("Game (March 29th, 2014)");
        assert_eq!(day.date.as_deref(), Some("2014-03-29"));
        assert_eq!(day.precision.as_deref(), Some("day"));
        let month = parse_snapshot("Game may 2012");
        assert_eq!(month.date.as_deref(), Some("2012-05-01"));
        assert_eq!(month.precision.as_deref(), Some("month"));
    }

    #[test]
    fn extracts_discovery_candidates() {
        let text = r#"<string name="Name">BadgeID</string><int name="Value">15895090</int>
game.PlaceId == 12345 Teleport(67890) https://www.roblox.com/games/24680/title"#;
        let badge = Regex::new(
            r#"(?is)<string\s+name="Name">[^<]*badge[^<]*</string>.{0,320}?<(?:int|int64|string|double)\s+name="Value">\s*(\d{5,18})"#,
        )
        .unwrap();
        assert_eq!(capture_ids(text, &badge), vec![15_895_090]);
    }

    #[test]
    fn compares_normalized_titles() {
        assert!(titles_correspond(
            "Apocalypse Rising 2014+",
            "Apocalypse Rising"
        ));
        assert!(!titles_correspond("City", "Crossroads"));
    }
}
