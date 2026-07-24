(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.RecordUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const RAW_BASE_URL =
    "https://raw.githubusercontent.com/Builder-Pals/native-level-archive/main/";
  const BLOB_PATH_PATTERN =
    /^(levels|quarantine)\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\.(rbxl|rbxlx|bin)$/;
  const MONTHS = new Map([
    ["january", 1],
    ["february", 2],
    ["march", 3],
    ["april", 4],
    ["may", 5],
    ["june", 6],
    ["july", 7],
    ["august", 8],
    ["september", 9],
    ["october", 10],
    ["november", 11],
    ["december", 12],
  ]);
  const MONTH_PATTERN = Array.from(MONTHS.keys()).join("|");

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validCalendarDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function isoDate(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
      day,
    ).padStart(2, "0")}`;
  }

  function parseSnapshot(title) {
    const snapshot = {};
    const labels = Array.from(String(title).matchAll(/\(([^()]*)\)/g));
    if (labels.length > 0) {
      snapshot.label = labels[labels.length - 1][1].trim();
    }

    const fullDate = new RegExp(
      `(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`,
      "i",
    ).exec(title);
    if (fullDate) {
      const month = MONTHS.get(fullDate[1].toLowerCase());
      const day = Number(fullDate[2]);
      const year = Number(fullDate[3]);
      if (validCalendarDate(year, month, day)) {
        snapshot.date = isoDate(year, month, day);
        snapshot.precision = "day";
        return snapshot;
      }
    }

    const monthDate = new RegExp(`(${MONTH_PATTERN})\\s+(\\d{4})`, "i").exec(title);
    if (monthDate) {
      const month = MONTHS.get(monthDate[1].toLowerCase());
      const year = Number(monthDate[2]);
      if (validCalendarDate(year, month, 1)) {
        snapshot.date = isoDate(year, month, 1);
        snapshot.precision = "month";
        return snapshot;
      }
    }

    const yearDate = /(?:^|[^0-9])(200[6-9]|201[0-9]|202[0-3])(?:[^0-9]|$)/.exec(title);
    if (yearDate) {
      snapshot.date = `${yearDate[1]}-01-01`;
      snapshot.precision = "year";
    }
    return snapshot;
  }

  function stripLevelExtension(filename) {
    return String(filename).replace(/\.(?:rbxlx|rbxl)$/i, "");
  }

  function firstMeaningfulByte(bytes) {
    let index = 0;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      index = 3;
    }
    while (
      index < bytes.length &&
      (bytes[index] === 0x20 || (bytes[index] >= 0x09 && bytes[index] <= 0x0d))
    ) {
      index += 1;
    }
    return index === bytes.length ? 0 : index;
  }

  function asciiPrefix(bytes, start, length) {
    return String.fromCharCode(...bytes.slice(start, start + length));
  }

  async function inspectPlace(bytes, validateXml) {
    if (bytes.length === 0) {
      return {
        format: "invalid",
        validation: { status: "invalid", reason: "empty file" },
      };
    }
    if (bytes.every((byte) => byte === 0)) {
      return {
        format: "invalid",
        validation: { status: "invalid", reason: "file contains only zero bytes" },
      };
    }

    const start = firstMeaningfulByte(bytes);
    const prefix = asciiPrefix(bytes, start, 16);
    if (prefix.startsWith("<roblox!")) {
      return { format: "binary", validation: { status: "valid" } };
    }
    if (prefix.startsWith("<roblox") || prefix.startsWith("<?xml")) {
      try {
        if (validateXml) {
          await validateXml(bytes.slice(start));
        }
        return { format: "xml", validation: { status: "valid" } };
      } catch (error) {
        return {
          format: "invalid",
          validation: {
            status: "invalid",
            reason: `malformed XML: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    }
    return {
      format: "invalid",
      validation: { status: "invalid", reason: "unrecognized Roblox place encoding" },
    };
  }

  async function sha256Hex(value) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error("Web Crypto is unavailable. Open the editor in a secure browser context.");
    }
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  async function createRecord(options) {
    const bytes =
      options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes);
    const sha256 = await sha256Hex(bytes);
    const inspected = await inspectPlace(bytes, options.validateXml);
    const extension =
      inspected.format === "xml" ? "rbxlx" : inspected.format === "binary" ? "rbxl" : "bin";
    const base = inspected.validation.status === "valid" ? "levels/sha256" : "quarantine/sha256";
    const path = `${base}/${sha256.slice(0, 2)}/${sha256}.${extension}`;
    const recordHash = await sha256Hex(
      new TextEncoder().encode(`record-v1\0${options.originalPath}`),
    );

    return {
      schema_version: SCHEMA_VERSION,
      id: `nla_${recordHash.slice(0, 32)}`,
      title: options.title,
      snapshot: parseSnapshot(options.title),
      blob: {
        sha256,
        path,
        format: inspected.format,
        size_bytes: bytes.byteLength,
        download_url: `${RAW_BASE_URL}${path}`,
      },
      validation: inspected.validation,
      provenance: {
        original_paths: [options.originalPath],
        collection: options.collection,
      },
      discovery: {},
      match: {
        status: "unresolved",
        confidence: "none",
        reviewed: false,
      },
      preferred: false,
    };
  }

  function deepEqual(left, right) {
    if (left === right) {
      return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      return (
        left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
      );
    }
    if (isObject(left) && isObject(right)) {
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      return (
        deepEqual(leftKeys, rightKeys) &&
        leftKeys.every((key) => deepEqual(left[key], right[key]))
      );
    }
    return false;
  }

  function isSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function rejectUnknownProperties(value, allowed, label, errors) {
    if (!isObject(value)) {
      return;
    }
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      errors.push(`${label} contains unknown properties: ${unknown.join(", ")}.`);
    }
  }

  function validatePositiveIdArray(value, label, errors) {
    if (
      !Array.isArray(value) ||
      value.some((item) => !isPositiveInteger(item)) ||
      new Set(value).size !== value.length
    ) {
      errors.push(`${label} must contain unique positive integers.`);
    }
  }

  function isPublishableRecord(record) {
    return Boolean(
      record &&
        record.validation?.status === "valid" &&
        isObject(record.source) &&
        ((record.match?.status === "verified" && record.match?.confidence === "high") ||
          record.match?.reviewed),
    );
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function knownPlaceAssociation(records, rootPlaceId, excludeId = null) {
    if (!Array.isArray(records) || !Number.isSafeInteger(rootPlaceId) || rootPlaceId <= 0) {
      return null;
    }
    const matches = records.filter(
      (record) =>
        record?.id !== excludeId &&
        isPublishableRecord(record) &&
        record.source.root_place_id === rootPlaceId,
    );
    if (matches.length === 0) {
      return null;
    }
    const universeIds = new Set(matches.map((record) => record.source.universe_id));
    if (universeIds.size !== 1) {
      throw new Error(`Existing records disagree about the universe for place ${rootPlaceId}.`);
    }
    const representative = matches.find((record) => record.preferred) || matches[0];
    return {
      rootPlaceId,
      universeId: representative.source.universe_id,
      name: representative.source.name,
      recordCount: matches.length,
      preferredId: matches.find((record) => record.preferred)?.id || null,
    };
  }

  function planPlaceAssociation(records, selectedId, association) {
    if (!Array.isArray(records)) {
      throw new Error("Records must be an array.");
    }
    const selectedOriginal = records.find((record) => record?.id === selectedId);
    if (!selectedOriginal) {
      throw new Error("The selected record could not be found.");
    }
    if (selectedOriginal.validation?.status !== "valid") {
      throw new Error("Only a valid place file can be associated with a Roblox place.");
    }

    const rootPlaceId = association?.rootPlaceId;
    const universeId = association?.universeId;
    const name = typeof association?.name === "string" ? association.name.trim() : "";
    const evidenceDetail =
      typeof association?.evidenceDetail === "string" ? association.evidenceDetail.trim() : "";
    if (!Number.isSafeInteger(rootPlaceId) || rootPlaceId <= 0) {
      throw new Error("Root place ID must be a positive integer.");
    }
    if (!Number.isSafeInteger(universeId) || universeId <= 0) {
      throw new Error("Universe ID must be a positive integer.");
    }
    if (name === "") {
      throw new Error("Place name is required.");
    }
    if (evidenceDetail === "") {
      throw new Error("Review evidence is required for a manual place association.");
    }

    const existingTargetRecords = records.filter(
      (record) =>
        record?.id !== selectedId &&
        isPublishableRecord(record) &&
        record.source.root_place_id === rootPlaceId,
    );
    const conflictingUniverse = existingTargetRecords.find(
      (record) => record.source.universe_id !== universeId,
    );
    if (conflictingUniverse) {
      throw new Error(
        `Universe ID does not match existing record ${conflictingUniverse.id} for place ${rootPlaceId}.`,
      );
    }

    const copies = records.map((record) => cloneJson(record));
    const selected = copies.find((record) => record.id === selectedId);
    const oldPlaceId = isPublishableRecord(selectedOriginal)
      ? selectedOriginal.source.root_place_id
      : null;
    const movedFromOldPlace = oldPlaceId !== null && oldPlaceId !== rootPlaceId;

    const sameSourceIdentity =
      selected.source?.root_place_id === rootPlaceId &&
      selected.source?.universe_id === universeId;
    selected.source = {
      ...(sameSourceIdentity && isObject(selected.source) ? selected.source : {}),
      root_place_id: rootPlaceId,
      universe_id: universeId,
      name,
      roblox_url: `https://www.roblox.com/games/${rootPlaceId}`,
    };
    selected.match = {
      ...(isObject(selected.match) ? selected.match : {}),
      status: "verified",
      confidence: "high",
      reviewed: true,
      evidence: [
        ...(Array.isArray(selected.match?.evidence)
          ? selected.match.evidence.filter(
              (item) => !(item?.kind === "manual" && item?.value === String(rootPlaceId)),
            )
          : []),
        {
          kind: "manual",
          value: String(rootPlaceId),
          detail: evidenceDetail,
        },
      ],
    };
    selected.preferred = Boolean(association.preferred);

    if (selected.preferred) {
      for (const record of copies) {
        if (
          record.id !== selectedId &&
          record.source?.root_place_id === rootPlaceId
        ) {
          record.preferred = false;
        }
      }
    } else {
      const targetPreferred = copies.filter(
        (record) =>
          record.id !== selectedId &&
          isPublishableRecord(record) &&
          record.source.root_place_id === rootPlaceId &&
          record.preferred,
      );
      if (targetPreferred.length !== 1) {
        throw new Error(
          `Place ${rootPlaceId} needs exactly one preferred snapshot. Make this record preferred or retain one existing preferred record.`,
        );
      }
    }

    if (movedFromOldPlace) {
      const oldRemaining = copies.filter(
        (record) =>
          record.id !== selectedId &&
          isPublishableRecord(record) &&
          record.source.root_place_id === oldPlaceId,
      );
      if (oldRemaining.length > 0 && selectedOriginal.preferred) {
        const replacement = oldRemaining.find(
          (record) => record.id === association.oldPreferredRecordId,
        );
        if (!replacement) {
          throw new Error(`Choose a replacement preferred snapshot for old place ${oldPlaceId}.`);
        }
        for (const record of copies) {
          if (record.source?.root_place_id === oldPlaceId) {
            record.preferred = record.id === replacement.id;
          }
        }
      } else if (oldRemaining.length > 0) {
        const oldPreferred = oldRemaining.filter((record) => record.preferred);
        if (oldPreferred.length !== 1) {
          throw new Error(`Old place ${oldPlaceId} does not have exactly one preferred snapshot.`);
        }
      }
    }

    const updates = copies
      .map((record, index) => ({ record, original: records[index] }))
      .filter(({ record, original }) => !deepEqual(record, original))
      .map(({ record }) => ({ id: record.id, record }));
    return { updates };
  }

  function planRecordRemoval(records, selectedId, replacementPreferredId = null) {
    if (!Array.isArray(records)) {
      throw new Error("Records must be an array.");
    }
    const selected = records.find((record) => record?.id === selectedId);
    if (!selected) {
      throw new Error("The selected record could not be found.");
    }
    if (
      typeof selected.blob?.path !== "string" ||
      selected.blob.path === "" ||
      selected.blob.path.includes("..") ||
      selected.blob.path.includes("\\") ||
      selected.blob.path.startsWith("/")
    ) {
      throw new Error("The selected record does not have a safe blob path.");
    }

    const selectedPlaceId = isPublishableRecord(selected)
      ? selected.source.root_place_id
      : null;
    const remainingPlaceRecords =
      selectedPlaceId === null
        ? []
        : records.filter(
            (record) =>
              record?.id !== selectedId &&
              isPublishableRecord(record) &&
              record.source.root_place_id === selectedPlaceId,
          );

    const copies = records.map((record) => cloneJson(record));
    if (selected.preferred && remainingPlaceRecords.length > 0) {
      const replacement = remainingPlaceRecords.find(
        (record) => record.id === replacementPreferredId,
      );
      if (!replacement) {
        throw new Error(
          `Choose a replacement preferred snapshot for place ${selectedPlaceId}.`,
        );
      }
      for (const record of copies) {
        if (
          record.id !== selectedId &&
          isPublishableRecord(record) &&
          record.source.root_place_id === selectedPlaceId
        ) {
          record.preferred = record.id === replacement.id;
        }
      }
    }

    const updates = copies
      .map((record, index) => ({ record, original: records[index] }))
      .filter(
        ({ record, original }) =>
          record.id !== selectedId && !deepEqual(record, original),
      )
      .map(({ record }) => ({ id: record.id, record }));
    const sharedBlobRecordIds = records
      .filter(
        (record) =>
          record?.id !== selectedId && record?.blob?.path === selected.blob.path,
      )
      .map((record) => record.id);

    return {
      updates,
      removeBlob: sharedBlobRecordIds.length === 0,
      sharedBlobRecordIds,
    };
  }

  function validateRecord(record, constraints = {}) {
    const errors = [];
    if (!isObject(record)) {
      return ["The record must be a JSON object."];
    }
    rejectUnknownProperties(
      record,
      [
        "schema_version",
        "id",
        "title",
        "aliases",
        "snapshot",
        "blob",
        "validation",
        "provenance",
        "badges",
        "discovery",
        "source",
        "match",
        "preferred",
      ],
      "record",
      errors,
    );
    if (record.schema_version !== SCHEMA_VERSION) {
      errors.push(`schema_version must be ${SCHEMA_VERSION}.`);
    }
    if (typeof record.id !== "string" || !/^nla_[a-f0-9]{32}$/.test(record.id)) {
      errors.push("id must match nla_ followed by 32 lowercase hexadecimal characters.");
    }
    if (constraints.expectedId && record.id !== constraints.expectedId) {
      errors.push("The ID of an existing record cannot be changed.");
    }
    if (typeof record.title !== "string" || record.title.trim() === "") {
      errors.push("title must be a non-empty string.");
    }
    if (
      record.aliases !== undefined &&
      (!Array.isArray(record.aliases) ||
        record.aliases.some((alias) => typeof alias !== "string" || alias === "") ||
        new Set(record.aliases).size !== record.aliases.length)
    ) {
      errors.push("aliases must contain unique non-empty strings when present.");
    }
    if (!isObject(record.snapshot)) {
      errors.push("snapshot must be an object (use {} when unknown).");
    } else {
      rejectUnknownProperties(record.snapshot, ["label", "date", "precision"], "snapshot", errors);
      if (record.snapshot.label !== undefined && typeof record.snapshot.label !== "string") {
        errors.push("snapshot.label must be a string when present.");
      }
      const hasDate = record.snapshot.date !== undefined;
      const hasPrecision = record.snapshot.precision !== undefined;
      if (hasDate !== hasPrecision) {
        errors.push("snapshot.date and snapshot.precision must be provided together.");
      }
      if (
        hasDate &&
        (typeof record.snapshot.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(record.snapshot.date))
      ) {
        errors.push("snapshot.date must use YYYY-MM-DD format.");
      }
      if (hasPrecision && !["day", "month", "year"].includes(record.snapshot.precision)) {
        errors.push("snapshot.precision must be day, month, or year.");
      }
    }
    if (!isObject(record.blob)) {
      errors.push("blob must be an object.");
    } else {
      rejectUnknownProperties(
        record.blob,
        ["sha256", "path", "format", "size_bytes", "download_url"],
        "blob",
        errors,
      );
      if (typeof record.blob.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.blob.sha256)) {
        errors.push("blob.sha256 must be 64 lowercase hexadecimal characters.");
      }
      const pathMatch =
        typeof record.blob.path === "string" ? BLOB_PATH_PATTERN.exec(record.blob.path) : null;
      if (!pathMatch) {
        errors.push("blob.path must be a canonical content-addressed archive path.");
      } else if (
        pathMatch[2] !== record.blob.sha256?.slice(0, 2) ||
        pathMatch[3] !== record.blob.sha256
      ) {
        errors.push("blob.path must contain blob.sha256 and its two-character prefix.");
      }
      if (!isSafeInteger(record.blob.size_bytes)) {
        errors.push("blob.size_bytes must be a non-negative safe integer.");
      }
      if (!["xml", "binary", "invalid"].includes(record.blob.format)) {
        errors.push("blob.format must be xml, binary, or invalid.");
      }
      if (record.blob.download_url !== `${RAW_BASE_URL}${record.blob.path}`) {
        errors.push("blob.download_url must be the canonical raw URL for blob.path.");
      }
    }
    if (constraints.expectedBlob && !deepEqual(record.blob, constraints.expectedBlob)) {
      errors.push(
        "The blob reference of an existing record cannot be changed here; archive blobs are immutable.",
      );
    }
    if (!isObject(record.validation)) {
      errors.push("validation.status must be present.");
    } else {
      rejectUnknownProperties(record.validation, ["status", "reason"], "validation", errors);
      if (!["valid", "invalid"].includes(record.validation.status)) {
        errors.push("validation.status must be valid or invalid.");
      }
      if (
        record.validation.reason !== undefined &&
        (typeof record.validation.reason !== "string" || record.validation.reason === "")
      ) {
        errors.push("validation.reason must be a non-empty string when present.");
      }
      if (
        record.validation.status === "valid" &&
        (!["xml", "binary"].includes(record.blob?.format) ||
          !record.blob?.path?.startsWith("levels/"))
      ) {
        errors.push("Valid records must reference an XML or binary blob beneath levels/.");
      }
      if (
        record.validation.status === "invalid" &&
        (record.blob?.format !== "invalid" || !record.blob?.path?.startsWith("quarantine/"))
      ) {
        errors.push("Invalid records must reference an invalid blob beneath quarantine/.");
      }
    }
    if (!isObject(record.provenance)) {
      errors.push("provenance must be an object.");
    } else {
      rejectUnknownProperties(
        record.provenance,
        [
          "original_paths",
          "collection",
          "legacy_metadata_path",
          "legacy_creator",
          "notes",
        ],
        "provenance",
        errors,
      );
      if (
        !Array.isArray(record.provenance.original_paths) ||
        record.provenance.original_paths.length === 0 ||
        record.provenance.original_paths.some(
          (path) => typeof path !== "string" || path.trim() === "",
        )
      ) {
        errors.push("provenance.original_paths must contain at least one non-empty string.");
      }
      if (
        typeof record.provenance.collection !== "string" ||
        record.provenance.collection.trim() === ""
      ) {
        errors.push("provenance.collection must be a non-empty string.");
      }
    }
    if (record.badges !== undefined) {
      if (!Array.isArray(record.badges)) {
        errors.push("badges must be an array when present.");
      } else if (
        record.badges.some(
          (badge) =>
            !isObject(badge) ||
            !isPositiveInteger(badge.id) ||
            typeof badge.origin !== "string" ||
            badge.origin === "",
        )
      ) {
        errors.push("Each badge must have a positive integer id and non-empty origin.");
      } else {
        for (const badge of record.badges) {
          rejectUnknownProperties(badge, ["id", "name", "origin"], "badge", errors);
        }
      }
    }
    if (!isObject(record.discovery)) {
      errors.push("discovery must be an object (use {} when empty).");
    } else {
      rejectUnknownProperties(
        record.discovery,
        ["badge_ids", "place_ids", "teleport_place_ids"],
        "discovery",
        errors,
      );
      for (const field of ["badge_ids", "place_ids", "teleport_place_ids"]) {
        if (record.discovery[field] !== undefined) {
          validatePositiveIdArray(record.discovery[field], `discovery.${field}`, errors);
        }
      }
    }
    if (record.source !== undefined) {
      if (!isObject(record.source)) {
        errors.push("source must be an object when present.");
      } else {
        rejectUnknownProperties(
          record.source,
          [
            "root_place_id",
            "universe_id",
            "name",
            "roblox_url",
            "description",
            "creator",
            "created_at",
            "updated_at",
          ],
          "source",
          errors,
        );
        if (!isPositiveInteger(record.source.root_place_id)) {
          errors.push("source.root_place_id must be a positive integer.");
        }
        if (!isPositiveInteger(record.source.universe_id)) {
          errors.push("source.universe_id must be a positive integer.");
        }
        if (typeof record.source.name !== "string" || record.source.name.trim() === "") {
          errors.push("source.name must be a non-empty string.");
        }
        if (
          record.source.roblox_url !==
          `https://www.roblox.com/games/${record.source.root_place_id}`
        ) {
          errors.push("source.roblox_url must be the canonical URL for source.root_place_id.");
        }
      }
    }
    if (!isObject(record.match)) {
      errors.push("match must contain string status/confidence fields and a boolean reviewed field.");
    } else {
      rejectUnknownProperties(
        record.match,
        ["status", "confidence", "reviewed", "evidence"],
        "match",
        errors,
      );
      if (!["unresolved", "candidate", "conflict", "verified"].includes(record.match.status)) {
        errors.push("match.status is not recognized.");
      }
      if (!["none", "medium", "high"].includes(record.match.confidence)) {
        errors.push("match.confidence is not recognized.");
      }
      if (typeof record.match.reviewed !== "boolean") {
        errors.push("match.reviewed must be a boolean.");
      }
      const expectedConfidence = {
        unresolved: "none",
        candidate: "medium",
        conflict: "none",
        verified: "high",
      }[record.match.status];
      if (expectedConfidence && record.match.confidence !== expectedConfidence) {
        errors.push(`match.confidence must be ${expectedConfidence} for ${record.match.status}.`);
      }
      if (
        record.match.evidence !== undefined &&
        (!Array.isArray(record.match.evidence) ||
          record.match.evidence.some(
            (item) =>
              !isObject(item) ||
              ["kind", "value", "detail"].some(
                (field) => typeof item[field] !== "string" || item[field] === "",
              ),
          ))
      ) {
        errors.push("match.evidence entries must contain non-empty kind, value, and detail.");
      } else {
        for (const item of record.match.evidence || []) {
          rejectUnknownProperties(item, ["kind", "value", "detail"], "match evidence", errors);
        }
      }
    }
    if (typeof record.preferred !== "boolean") {
      errors.push("preferred must be a boolean.");
    }
    return errors;
  }

  function recordStatus(record) {
    if (!record || record.validation?.status !== "valid") {
      return "invalid";
    }
    if (record.match?.reviewed) {
      return "reviewed";
    }
    if (record.match?.status === "verified") {
      return "verified";
    }
    return "unresolved";
  }

  function recordSearchText(record, filename) {
    return [
      filename,
      record?.id,
      record?.title,
      record?.source?.name,
      record?.source?.root_place_id,
      record?.source?.universe_id,
      ...(record?.aliases || []),
      ...(record?.provenance?.original_paths || []),
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();
  }

  return {
    RAW_BASE_URL,
    SCHEMA_VERSION,
    createRecord,
    deepEqual,
    inspectPlace,
    isPublishableRecord,
    knownPlaceAssociation,
    parseSnapshot,
    planPlaceAssociation,
    planRecordRemoval,
    recordSearchText,
    recordStatus,
    sha256Hex,
    stripLevelExtension,
    validateRecord,
  };
});
