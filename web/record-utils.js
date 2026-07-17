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

  function validateRecord(record, constraints = {}) {
    const errors = [];
    if (!isObject(record)) {
      return ["The record must be a JSON object."];
    }
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
    if (!isObject(record.snapshot)) {
      errors.push("snapshot must be an object (use {} when unknown).");
    }
    if (!isObject(record.blob)) {
      errors.push("blob must be an object.");
    } else {
      if (typeof record.blob.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.blob.sha256)) {
        errors.push("blob.sha256 must be 64 lowercase hexadecimal characters.");
      }
      if (
        typeof record.blob.path !== "string" ||
        record.blob.path === "" ||
        record.blob.path.includes("..") ||
        record.blob.path.includes("\\") ||
        record.blob.path.startsWith("/")
      ) {
        errors.push("blob.path must be a safe repository-relative path using forward slashes.");
      }
      if (!isSafeInteger(record.blob.size_bytes)) {
        errors.push("blob.size_bytes must be a non-negative safe integer.");
      }
      if (typeof record.blob.format !== "string" || record.blob.format === "") {
        errors.push("blob.format must be a non-empty string.");
      }
      if (typeof record.blob.download_url !== "string" || record.blob.download_url === "") {
        errors.push("blob.download_url must be a non-empty string.");
      }
    }
    if (constraints.expectedBlob && !deepEqual(record.blob, constraints.expectedBlob)) {
      errors.push(
        "The blob reference of an existing record cannot be changed here; archive blobs are immutable.",
      );
    }
    if (!isObject(record.validation) || typeof record.validation.status !== "string") {
      errors.push("validation.status must be present.");
    }
    if (!isObject(record.provenance)) {
      errors.push("provenance must be an object.");
    } else {
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
      } else if (record.badges.some((badge) => !isObject(badge) || !isSafeInteger(badge.id))) {
        errors.push("Each badge must be an object with a non-negative integer id.");
      }
    }
    if (!isObject(record.discovery)) {
      errors.push("discovery must be an object (use {} when empty).");
    }
    if (record.source !== undefined) {
      if (!isObject(record.source)) {
        errors.push("source must be an object when present.");
      } else {
        if (!Number.isSafeInteger(record.source.root_place_id) || record.source.root_place_id <= 0) {
          errors.push("source.root_place_id must be a positive integer.");
        }
        if (!Number.isSafeInteger(record.source.universe_id) || record.source.universe_id <= 0) {
          errors.push("source.universe_id must be a positive integer.");
        }
        if (typeof record.source.name !== "string" || record.source.name.trim() === "") {
          errors.push("source.name must be a non-empty string.");
        }
        if (
          typeof record.source.roblox_url !== "string" ||
          record.source.roblox_url.trim() === ""
        ) {
          errors.push("source.roblox_url must be a non-empty string.");
        }
      }
    }
    if (
      !isObject(record.match) ||
      typeof record.match.status !== "string" ||
      typeof record.match.confidence !== "string" ||
      typeof record.match.reviewed !== "boolean"
    ) {
      errors.push("match must contain string status/confidence fields and a boolean reviewed field.");
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

  async function fetchUniverseId(placeId, fetchImplementation = globalThis.fetch, options = {}) {
    if (!Number.isSafeInteger(placeId) || placeId <= 0) {
      throw new Error("Place ID must be a positive integer.");
    }
    if (typeof fetchImplementation !== "function") {
      throw new Error("This browser cannot contact the Roblox API.");
    }
    const response = await fetchImplementation(
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
      { signal: options.signal },
    );
    if (!response.ok) {
      throw new Error(`Roblox returned HTTP ${response.status}.`);
    }
    const result = await response.json();
    if (!Number.isSafeInteger(result?.universeId) || result.universeId <= 0) {
      throw new Error("Roblox returned an invalid universe ID.");
    }
    return result.universeId;
  }

  return {
    RAW_BASE_URL,
    SCHEMA_VERSION,
    createRecord,
    deepEqual,
    fetchUniverseId,
    inspectPlace,
    isPublishableRecord,
    knownPlaceAssociation,
    parseSnapshot,
    planPlaceAssociation,
    recordSearchText,
    recordStatus,
    sha256Hex,
    stripLevelExtension,
    validateRecord,
  };
});
