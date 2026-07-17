mod catalog;
mod git;
mod model;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(about = "Build and verify the Native Level Archive catalog")]
struct Cli {
    #[arg(long, default_value = ".")]
    root: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Import tracked Roblox place files from Git tree.
    Import {
        #[arg(long, default_value = "HEAD")]
        revision: String,
    },
    /// Remove imported legacy level paths and sidecars after verification.
    CleanLegacy {
        #[arg(long, default_value = "HEAD")]
        revision: String,
        #[arg(long)]
        apply: bool,
    },
    /// Restore content-addressed blobs from their exact historical Git objects.
    RestoreBlobs {
        #[arg(long, default_value = "HEAD^")]
        revision: String,
        #[arg(long)]
        apply: bool,
    },
    /// Extract badge and place ID candidates from imported levels.
    Discover,
    /// Resolve badge evidence and current Roblox metadata.
    Enrich,
    /// Generate catalog-v1.json, place-index-v1.json, and the review queue.
    Build,
    /// Mark a reviewed record as the preferred variant for its place ID.
    Prefer { record_id: String },
    /// Verify records, blobs, indexes, and regression counts.
    Verify,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let root = cli.root.canonicalize()?;
    match cli.command {
        Command::Import { revision } => catalog::import(&root, &revision),
        Command::CleanLegacy { revision, apply } => catalog::clean_legacy(&root, &revision, apply),
        Command::RestoreBlobs { revision, apply } => {
            catalog::restore_blobs(&root, &revision, apply)
        }
        Command::Discover => catalog::discover(&root),
        Command::Enrich => catalog::enrich(&root).await,
        Command::Build => catalog::build(&root),
        Command::Prefer { record_id } => catalog::prefer(&root, &record_id),
        Command::Verify => catalog::verify(&root),
    }
}
