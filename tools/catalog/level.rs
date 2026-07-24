use anyhow::Result;
use quick_xml::{events::Event, Reader};

use crate::model::Validation;

pub fn inspect(bytes: &[u8]) -> (String, Validation) {
    if bytes.is_empty() {
        return (
            "invalid".into(),
            Validation {
                status: "invalid".into(),
                reason: Some("empty file".into()),
            },
        );
    }
    if bytes.iter().all(|byte| *byte == 0) {
        return (
            "invalid".into(),
            Validation {
                status: "invalid".into(),
                reason: Some("file contains only zero bytes".into()),
            },
        );
    }
    let trimmed = trim_prefix(bytes);
    if trimmed.starts_with(b"<roblox!") {
        return (
            "binary".into(),
            Validation {
                status: "valid".into(),
                reason: None,
            },
        );
    }
    if trimmed.starts_with(b"<roblox") || trimmed.starts_with(b"<?xml") {
        return match validate_xml(trimmed) {
            Ok(()) => (
                "xml".into(),
                Validation {
                    status: "valid".into(),
                    reason: None,
                },
            ),
            Err(error) => (
                "invalid".into(),
                Validation {
                    status: "invalid".into(),
                    reason: Some(format!("malformed XML: {error}")),
                },
            ),
        };
    }
    (
        "invalid".into(),
        Validation {
            status: "invalid".into(),
            reason: Some("unrecognized Roblox place encoding".into()),
        },
    )
}

fn trim_prefix(mut bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        bytes = &bytes[3..];
    }
    let offset = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(0);
    &bytes[offset..]
}

fn validate_xml(bytes: &[u8]) -> Result<()> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Eof => return Ok(()),
            _ => buffer.clear(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_place_formats_and_corruption() {
        assert_eq!(inspect(b"<roblox version=\"4\"></roblox>").0, "xml");
        assert_eq!(inspect(b"<roblox!binary").0, "binary");
        assert_eq!(inspect(b"").1.status, "invalid");
        assert_eq!(inspect(&[0, 0, 0]).1.status, "invalid");
    }
}
