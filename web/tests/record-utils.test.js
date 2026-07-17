"use strict";

const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const utils = require("../record-utils.js");

async function run() {
  assert.deepEqual(utils.parseSnapshot("Game (March 29th, 2014)"), {
    label: "March 29th, 2014",
    date: "2014-03-29",
    precision: "day",
  });
  assert.deepEqual(utils.parseSnapshot("Game may 2012"), {
    date: "2012-05-01",
    precision: "month",
  });
  assert.deepEqual(utils.parseSnapshot("Game 2009"), {
    date: "2009-01-01",
    precision: "year",
  });

  assert.equal((await utils.inspectPlace(new Uint8Array())).validation.reason, "empty file");
  assert.equal(
    (await utils.inspectPlace(new Uint8Array([0, 0, 0]))).validation.reason,
    "file contains only zero bytes",
  );
  assert.deepEqual(
    await utils.inspectPlace(new TextEncoder().encode("<roblox!binary")),
    { format: "binary", validation: { status: "valid" } },
  );
  const malformed = await utils.inspectPlace(
    new TextEncoder().encode("<roblox>"),
    async () => {
      throw new Error("not closed");
    },
  );
  assert.equal(malformed.format, "invalid");
  assert.equal(malformed.validation.reason, "malformed XML: not closed");

  const record = await utils.createRecord({
    bytes: new TextEncoder().encode("<roblox!binary"),
    title: "Example (2012)",
    originalPath: "Kanvas/Example.rbxl",
    collection: "Kanvas",
  });
  assert.match(record.id, /^nla_[a-f0-9]{32}$/);
  assert.match(record.blob.sha256, /^[a-f0-9]{64}$/);
  assert.equal(record.blob.format, "binary");
  assert.equal(record.blob.path, `levels/sha256/${record.blob.sha256.slice(0, 2)}/${record.blob.sha256}.rbxl`);
  assert.equal(record.provenance.original_paths[0], "Kanvas/Example.rbxl");
  assert.deepEqual(utils.validateRecord(record), []);

  const edited = JSON.parse(JSON.stringify(record));
  edited.title = "Changed";
  assert.deepEqual(
    utils.validateRecord(edited, { expectedId: record.id, expectedBlob: record.blob }),
    [],
  );
  edited.blob.path = "levels/changed.rbxl";
  assert.ok(
    utils
      .validateRecord(edited, { expectedId: record.id, expectedBlob: record.blob })
      .some((error) => error.includes("immutable")),
  );

  const idFor = (character) => `nla_${character.repeat(32)}`;
  const withId = (value, id) => ({
    ...JSON.parse(JSON.stringify(value)),
    id,
    title: `Record ${id.slice(-4)}`,
  });
  const association = {
    rootPlaceId: 12345,
    universeId: 67890,
    name: "Example place",
    preferred: true,
  };

  const firstPlan = utils.planPlaceAssociation([record], record.id, association);
  assert.equal(firstPlan.updates.length, 1);
  const associated = firstPlan.updates[0].record;
  assert.deepEqual(associated.source, {
    root_place_id: 12345,
    universe_id: 67890,
    name: "Example place",
    roblox_url: "https://www.roblox.com/games/12345",
  });
  assert.deepEqual(associated.match, {
    status: "verified",
    confidence: "high",
    reviewed: true,
  });
  assert.equal(associated.preferred, true);
  assert.equal(utils.isPublishableRecord(associated), true);

  associated.source.description = "Retained metadata";
  associated.match.evidence = [{ kind: "manual", value: "12345" }];
  const retained = utils.planPlaceAssociation([associated], associated.id, {
    ...association,
    name: "Updated name",
  }).updates[0].record;
  assert.equal(retained.source.description, "Retained metadata");
  assert.deepEqual(retained.match.evidence, [{ kind: "manual", value: "12345" }]);

  const existingPreferred = withId(associated, idFor("b"));
  const replacesPreferred = utils.planPlaceAssociation(
    [record, existingPreferred],
    record.id,
    association,
  );
  assert.equal(
    replacesPreferred.updates.find((update) => update.id === existingPreferred.id).record.preferred,
    false,
  );
  assert.equal(
    replacesPreferred.updates.find((update) => update.id === record.id).record.preferred,
    true,
  );

  const keepsPreferred = utils.planPlaceAssociation([record, existingPreferred], record.id, {
    ...association,
    preferred: false,
  });
  assert.equal(keepsPreferred.updates.length, 1);
  assert.equal(keepsPreferred.updates[0].record.preferred, false);

  assert.throws(
    () =>
      utils.planPlaceAssociation([record], record.id, {
        ...association,
        preferred: false,
      }),
    /exactly one preferred snapshot/,
  );

  const oldPreferred = withId(associated, idFor("c"));
  oldPreferred.source.description = "Metadata for the old place";
  const oldVariant = withId(associated, idFor("d"));
  oldVariant.preferred = false;
  assert.throws(
    () =>
      utils.planPlaceAssociation([oldPreferred, oldVariant], oldPreferred.id, {
        rootPlaceId: 22222,
        universeId: 33333,
        name: "New place",
        preferred: true,
      }),
    /replacement preferred snapshot/,
  );
  const moved = utils.planPlaceAssociation([oldPreferred, oldVariant], oldPreferred.id, {
    rootPlaceId: 22222,
    universeId: 33333,
    name: "New place",
    preferred: true,
    oldPreferredRecordId: oldVariant.id,
  });
  const movedSelected = moved.updates.find((update) => update.id === oldPreferred.id).record;
  const movedReplacement = moved.updates.find((update) => update.id === oldVariant.id).record;
  assert.equal(movedSelected.source.root_place_id, 22222);
  assert.equal(movedSelected.source.description, undefined);
  assert.equal(movedReplacement.preferred, true);

  assert.throws(
    () =>
      utils.planPlaceAssociation([record, existingPreferred], record.id, {
        ...association,
        universeId: 99999,
      }),
    /Universe ID does not match/,
  );

  console.log("record-utils tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
