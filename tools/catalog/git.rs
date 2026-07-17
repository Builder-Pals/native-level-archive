use std::{path::Path, process::Command};

use anyhow::{bail, Context, Result};

#[derive(Clone, Debug)]
pub struct TreeEntry {
    pub oid: String,
    pub size: u64,
    pub path: String,
}

pub fn list_tree(root: &Path, revision: &str) -> Result<Vec<TreeEntry>> {
    let output = Command::new("git")
        .current_dir(root)
        .args([
            "-c",
            "core.quotePath=false",
            "ls-tree",
            "-r",
            "-z",
            "-l",
            revision,
        ])
        .output()
        .context("failed to run git ls-tree")?;
    if !output.status.success() {
        bail!(
            "git ls-tree failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|line| !line.is_empty())
        .map(parse_entry)
        .collect()
}

fn parse_entry(line: &[u8]) -> Result<TreeEntry> {
    let tab = line
        .iter()
        .position(|byte| *byte == b'\t')
        .context("git tree entry had no path separator")?;
    let header = std::str::from_utf8(&line[..tab]).context("git tree header was not UTF-8")?;
    let path = std::str::from_utf8(&line[tab + 1..])
        .context("git path was not UTF-8")?
        .replace('\\', "/");
    let mut fields = header.split_whitespace();
    let _mode = fields.next().context("tree entry missing mode")?;
    let kind = fields.next().context("tree entry missing kind")?;
    if kind != "blob" {
        bail!("unexpected Git object kind {kind}");
    }
    let oid = fields
        .next()
        .context("tree entry missing object ID")?
        .into();
    let size = fields
        .next()
        .context("tree entry missing size")?
        .parse()
        .context("invalid Git blob size")?;
    Ok(TreeEntry { oid, size, path })
}

pub fn read_blob(root: &Path, oid: &str) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .current_dir(root)
        .args(["cat-file", "blob", oid])
        .output()
        .with_context(|| format!("failed to read Git blob {oid}"))?;
    if !output.status.success() {
        bail!(
            "git cat-file {oid} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ls_tree_entry() {
        let entry = parse_entry(b"100644 blob abcdef 42\tA Place.rbxl").unwrap();
        assert_eq!(entry.oid, "abcdef");
        assert_eq!(entry.size, 42);
        assert_eq!(entry.path, "A Place.rbxl");
    }
}
