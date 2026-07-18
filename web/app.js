(function () {
  "use strict";

  const utils = globalThis.RecordUtils;
  const elements = {
    addDialog: document.querySelector("#add-dialog"),
    addForm: document.querySelector("#add-form"),
    associatePlace: document.querySelector("#associate-place"),
    associationDialog: document.querySelector("#association-dialog"),
    associationEvidence: document.querySelector("#association-evidence"),
    associationErrors: document.querySelector("#association-errors"),
    associationForm: document.querySelector("#association-form"),
    associationName: document.querySelector("#association-name"),
    associationPlaceId: document.querySelector("#association-place-id"),
    associationPlaceLink: document.querySelector("#association-place-link"),
    associationPreferred: document.querySelector("#association-preferred"),
    associationRecord: document.querySelector("#association-record"),
    associationTargetSummary: document.querySelector("#association-target-summary"),
    associationUniverseId: document.querySelector("#association-universe-id"),
    associationUniverseLink: document.querySelector("#association-universe-link"),
    browserWarning: document.querySelector("#browser-warning"),
    cancelAdd: document.querySelector("#cancel-add"),
    cancelAssociation: document.querySelector("#cancel-association"),
    cancelRemove: document.querySelector("#cancel-remove"),
    collection: document.querySelector("#collection"),
    confirmAdd: document.querySelector("#confirm-add"),
    confirmAssociation: document.querySelector("#confirm-association"),
    confirmRemove: document.querySelector("#confirm-remove"),
    editor: document.querySelector("#editor"),
    entrySummary: document.querySelector("#entry-summary"),
    filter: document.querySelector("#filter"),
    message: document.querySelector("#message"),
    newEntry: document.querySelector("#new-entry"),
    newTitle: document.querySelector("#new-title"),
    knownPlaceIds: document.querySelector("#known-place-ids"),
    openRepository: document.querySelector("#open-repository"),
    originalPath: document.querySelector("#original-path"),
    oldPreferredField: document.querySelector("#old-preferred-field"),
    oldPreferredRecord: document.querySelector("#old-preferred-record"),
    placeFile: document.querySelector("#place-file"),
    recordCount: document.querySelector("#record-count"),
    recordList: document.querySelector("#record-list"),
    removeConfirmation: document.querySelector("#remove-confirmation"),
    removeDialog: document.querySelector("#remove-dialog"),
    removeEntry: document.querySelector("#remove-entry"),
    removeErrors: document.querySelector("#remove-errors"),
    removeForm: document.querySelector("#remove-form"),
    removeRecord: document.querySelector("#remove-record"),
    removeSummary: document.querySelector("#remove-summary"),
    replacementPreferredField: document.querySelector("#replacement-preferred-field"),
    replacementPreferredRecord: document.querySelector("#replacement-preferred-record"),
    repositoryStatus: document.querySelector("#repository-status"),
    revert: document.querySelector("#revert"),
    save: document.querySelector("#save"),
    search: document.querySelector("#search"),
    useKnownPlace: document.querySelector("#use-known-place"),
    validationErrors: document.querySelector("#validation-errors"),
  };

  const state = {
    records: [],
    recordsDirectory: null,
    rootDirectory: null,
    selected: null,
    originalEditorText: "",
    associationPlaceId: null,
    associationUniverseManuallyEdited: false,
    associationNameManuallyEdited: false,
  };

  function setMessage(text, kind = "") {
    elements.message.textContent = text;
    elements.message.dataset.kind = kind;
  }

  function setValidationErrors(errors) {
    elements.validationErrors.hidden = errors.length === 0;
    elements.validationErrors.textContent = errors.join("\n");
  }

  function isDirty() {
    return Boolean(state.selected) && elements.editor.value !== state.originalEditorText;
  }

  function confirmDiscard() {
    return !isDirty() || window.confirm("Discard the unsaved changes to this record?");
  }

  function updateEditorButtons() {
    const dirty = isDirty();
    elements.associatePlace.disabled = !state.selected || Boolean(state.selected.parseError);
    elements.save.disabled = !state.selected || !dirty;
    elements.revert.disabled = !state.selected || !dirty;
    elements.removeEntry.disabled = !state.selected || Boolean(state.selected.parseError);
  }

  function sortRecords() {
    state.records.sort((left, right) => {
      const leftTitle = left.data?.title || left.filename;
      const rightTitle = right.data?.title || right.filename;
      return leftTitle.localeCompare(rightTitle, undefined, { sensitivity: "base" });
    });
  }

  function renderRecordList() {
    const query = elements.search.value.trim().toLowerCase();
    const filter = elements.filter.value;
    const visible = state.records.filter((record) => {
      const matchesQuery =
        query === "" || utils.recordSearchText(record.data, record.filename).includes(query);
      const status = utils.recordStatus(record.data);
      return matchesQuery && (filter === "all" || status === filter);
    });

    const fragment = document.createDocumentFragment();
    for (const record of visible) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const title = document.createElement("span");
      const meta = document.createElement("span");
      button.type = "button";
      button.dataset.filename = record.filename;
      button.setAttribute("aria-current", String(record === state.selected));
      title.textContent = record.data?.title || record.filename;
      meta.className = "record-meta";
      meta.textContent = `${record.data?.id || "invalid JSON"} · ${utils.recordStatus(record.data)}`;
      button.append(title, meta);
      item.append(button);
      fragment.append(item);
    }
    elements.recordList.replaceChildren(fragment);
    elements.recordCount.textContent = `${visible.length} of ${state.records.length} records`;
  }

  function selectRecord(record) {
    if (record === state.selected) {
      return;
    }
    if (!confirmDiscard()) {
      return;
    }
    state.selected = record;
    state.originalEditorText = record.rawText;
    elements.editor.value = record.rawText;
    elements.editor.disabled = false;
    elements.entrySummary.textContent = record.parseError
      ? `${record.filename}: invalid JSON (${record.parseError})`
      : `${record.data.id} · ${utils.recordStatus(record.data)} · ${record.filename}`;
    setValidationErrors([]);
    updateEditorButtons();
    renderRecordList();
  }

  async function readRecord(filename, handle) {
    const file = await handle.getFile();
    const rawText = await file.text();
    try {
      return { filename, handle, rawText, data: JSON.parse(rawText), parseError: null };
    } catch (error) {
      return {
        filename,
        handle,
        rawText,
        data: null,
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function loadRecords() {
    const handles = [];
    for await (const [filename, handle] of state.recordsDirectory.entries()) {
      if (handle.kind === "file" && filename.toLowerCase().endsWith(".json")) {
        handles.push([filename, handle]);
      }
    }
    handles.sort((left, right) => left[0].localeCompare(right[0]));

    const records = [];
    const batchSize = 32;
    for (let index = 0; index < handles.length; index += batchSize) {
      const batch = handles.slice(index, index + batchSize);
      records.push(
        ...(await Promise.all(batch.map(([filename, handle]) => readRecord(filename, handle)))),
      );
      setMessage(`Loading records: ${Math.min(index + batch.length, handles.length)}/${handles.length}`);
    }
    state.records = records;
    sortRecords();
  }

  async function openRepository() {
    if (!confirmDiscard()) {
      return;
    }
    setMessage("Choose the native-level-archive repository directory.");
    try {
      const rootDirectory = await window.showDirectoryPicker({
        id: "native-level-archive",
        mode: "readwrite",
      });
      await rootDirectory.getFileHandle("Cargo.toml");
      const catalogDirectory = await rootDirectory.getDirectoryHandle("catalog");
      const recordsDirectory = await catalogDirectory.getDirectoryHandle("records");

      state.rootDirectory = rootDirectory;
      state.recordsDirectory = recordsDirectory;
      state.selected = null;
      state.originalEditorText = "";
      elements.editor.value = "";
      elements.editor.disabled = true;
      elements.entrySummary.textContent = "Select a record to edit it.";
      elements.openRepository.disabled = true;
      await loadRecords();

      elements.repositoryStatus.textContent = `${rootDirectory.name} · read/write`;
      elements.newEntry.disabled = false;
      elements.search.disabled = false;
      elements.filter.disabled = false;
      elements.openRepository.disabled = false;
      updateEditorButtons();
      renderRecordList();
      const invalidCount = state.records.filter((record) => record.parseError).length;
      setMessage(
        `Loaded ${state.records.length} source records${
          invalidCount ? ` (${invalidCount} with invalid JSON)` : ""
        }.`,
        "success",
      );
    } catch (error) {
      elements.openRepository.disabled = false;
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Repository selection cancelled.");
        return;
      }
      setMessage(
        `Could not open this repository: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function saveSelectedRecord() {
    if (!state.selected) {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(elements.editor.value);
    } catch (error) {
      setValidationErrors([
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      return;
    }

    const filenameId = state.selected.filename.replace(/\.json$/i, "");
    const errors = utils.validateRecord(parsed, {
      expectedId: filenameId,
      expectedBlob: state.selected.data?.blob,
    });
    setValidationErrors(errors);
    if (errors.length > 0) {
      return;
    }

    elements.save.disabled = true;
    try {
      const text = `${JSON.stringify(parsed, null, 2)}\n`;
      const writable = await state.selected.handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.selected.data = parsed;
      state.selected.rawText = text;
      state.selected.parseError = null;
      state.originalEditorText = text;
      elements.editor.value = text;
      elements.entrySummary.textContent = `${parsed.id} · ${utils.recordStatus(parsed)} · ${
        state.selected.filename
      }`;
      sortRecords();
      renderRecordList();
      updateEditorButtons();
      setMessage(
        `Saved ${state.selected.filename}. Generated indexes now need build and verify.`,
        "success",
      );
    } catch (error) {
      updateEditorButtons();
      setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function revertEditor() {
    elements.editor.value = state.originalEditorText;
    setValidationErrors([]);
    updateEditorButtons();
  }

  function numericInputValue(input) {
    return input.value.trim() === "" ? NaN : Number(input.value);
  }

  function associationRecordsForPlace(placeId, excludeSelected = false) {
    return state.records.filter(
      (item) =>
        item.data &&
        (!excludeSelected || item !== state.selected) &&
        utils.isPublishableRecord(item.data) &&
        item.data.source.root_place_id === placeId,
    );
  }

  function loadedRecordData() {
    return state.records.filter((item) => item.data).map((item) => item.data);
  }

  function knownAssociation(placeId) {
    return utils.knownPlaceAssociation(
      loadedRecordData(),
      placeId,
      state.selected?.data?.id || null,
    );
  }

  function fillKnownAssociationMetadata(force = false) {
    const placeId = numericInputValue(elements.associationPlaceId);
    const known = knownAssociation(placeId);
    if (!known) {
      return false;
    }
    if (force || !state.associationUniverseManuallyEdited) {
      elements.associationUniverseId.value = known.universeId;
    }
    if (force || !state.associationNameManuallyEdited) {
      elements.associationName.value = known.name;
    }
    return true;
  }

  function renderKnownPlaceOptions() {
    const known = new Map();
    for (const item of state.records) {
      const source = item.data?.source;
      if (utils.isPublishableRecord(item.data) && source && !known.has(source.root_place_id)) {
        known.set(source.root_place_id, source.name);
      }
    }
    const discovery = state.selected?.data?.discovery || {};
    for (const placeId of [
      ...(discovery.place_ids || []),
      ...(discovery.teleport_place_ids || []),
    ]) {
      if (Number.isSafeInteger(placeId) && placeId > 0 && !known.has(placeId)) {
        known.set(placeId, "discovered in this place file");
      }
    }
    const options = Array.from(known.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([placeId, label]) => {
        const option = document.createElement("option");
        option.value = String(placeId);
        option.label = label;
        return option;
      });
    elements.knownPlaceIds.replaceChildren(...options);
  }

  function renderAssociationContext() {
    if (!state.selected?.data) {
      return;
    }
    const newPlaceId = numericInputValue(elements.associationPlaceId);
    const targetRecords = Number.isSafeInteger(newPlaceId)
      ? associationRecordsForPlace(newPlaceId, true)
      : [];
    const targetPreferred = targetRecords.find((item) => item.data.preferred);
    const known = Number.isSafeInteger(newPlaceId) ? knownAssociation(newPlaceId) : null;
    elements.useKnownPlace.hidden = !known;
    elements.associationPlaceLink.hidden = !Number.isSafeInteger(newPlaceId) || newPlaceId <= 0;
    elements.associationUniverseLink.hidden = elements.associationPlaceLink.hidden;
    if (!elements.associationPlaceLink.hidden) {
      elements.associationPlaceLink.href = `https://www.roblox.com/games/${newPlaceId}`;
      elements.associationUniverseLink.href =
        `https://apis.roblox.com/universes/v1/places/${newPlaceId}/universe`;
    }
    if (targetRecords.length === 0) {
      elements.associationTargetSummary.textContent =
        "No other publishable snapshots currently use this place ID. Open the universe ID link and copy its value into the field.";
    } else if (elements.associationPreferred.checked) {
      elements.associationTargetSummary.textContent = targetPreferred
        ? `${targetRecords.length} other snapshot(s) use this place ID (universe ${known.universeId}). ${targetPreferred.data.title} will no longer be preferred.`
        : `${targetRecords.length} other snapshot(s) use this place ID (universe ${known.universeId}); none is currently preferred.`;
    } else {
      elements.associationTargetSummary.textContent = targetPreferred
        ? `${targetPreferred.data.title} will remain the preferred snapshot.`
        : "This place has no other preferred snapshot, so this record must be made preferred.";
    }

    const selected = state.selected.data;
    const oldPlaceId = utils.isPublishableRecord(selected)
      ? selected.source.root_place_id
      : null;
    const moved = Number.isSafeInteger(newPlaceId) && oldPlaceId !== null && newPlaceId !== oldPlaceId;
    const oldRemaining = moved ? associationRecordsForPlace(oldPlaceId, true) : [];
    const needsReplacement = moved && selected.preferred && oldRemaining.length > 0;
    elements.oldPreferredField.hidden = !needsReplacement;
    elements.oldPreferredRecord.required = needsReplacement;
    if (needsReplacement) {
      const previousValue = elements.oldPreferredRecord.value;
      const options = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = `Choose for place ${oldPlaceId}`;
      options.append(placeholder);
      for (const item of oldRemaining) {
        const option = document.createElement("option");
        option.value = item.data.id;
        option.textContent = `${item.data.title} (${item.data.id})`;
        options.append(option);
      }
      elements.oldPreferredRecord.replaceChildren(options);
      if (oldRemaining.some((item) => item.data.id === previousValue)) {
        elements.oldPreferredRecord.value = previousValue;
      }
    } else {
      elements.oldPreferredRecord.replaceChildren();
    }
  }

  function openAssociationDialog() {
    if (!state.selected?.data) {
      return;
    }
    if (isDirty()) {
      if (!window.confirm("Discard the unsaved JSON changes before editing the place association?")) {
        return;
      }
      revertEditor();
    }
    const record = state.selected.data;
    elements.associationForm.reset();
    elements.associationErrors.hidden = true;
    elements.associationErrors.textContent = "";
    elements.associationRecord.textContent = `${record.title} (${record.id})`;
    elements.associationPlaceId.value = record.source?.root_place_id ?? "";
    elements.associationUniverseId.value = record.source?.universe_id ?? "";
    elements.associationName.value = record.source?.name ?? record.title;
    elements.associationEvidence.value = Array.isArray(record.match?.evidence)
      ? record.match.evidence.at(-1)?.detail || ""
      : "";
    state.associationPlaceId = record.source?.root_place_id ?? null;
    state.associationUniverseManuallyEdited = Boolean(record.source);
    state.associationNameManuallyEdited = Boolean(record.source);
    const existingTarget = record.source
      ? associationRecordsForPlace(record.source.root_place_id, true)
      : [];
    elements.associationPreferred.checked = record.source
      ? record.preferred || !existingTarget.some((item) => item.data.preferred)
      : true;
    renderKnownPlaceOptions();
    renderAssociationContext();
    elements.associationDialog.showModal();
  }

  function closeAssociationDialog() {
    elements.associationDialog.close();
  }

  async function writeAssociationUpdates(updates) {
    const prepared = updates.map((update) => {
      const item = state.records.find((record) => record.data?.id === update.id);
      if (!item) {
        throw new Error(`Record ${update.id} is no longer loaded.`);
      }
      const errors = utils.validateRecord(update.record, {
        expectedId: update.id,
        expectedBlob: item.data.blob,
      });
      if (errors.length > 0) {
        throw new Error(`${update.id}: ${errors.join(" ")}`);
      }
      return {
        item,
        data: update.record,
        text: `${JSON.stringify(update.record, null, 2)}\n`,
        originalText: item.rawText,
      };
    });

    const written = [];
    try {
      for (const change of prepared) {
        const writable = await change.item.handle.createWritable();
        await writable.write(change.text);
        await writable.close();
        written.push(change);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const change of written.reverse()) {
        try {
          const writable = await change.item.handle.createWritable();
          await writable.write(change.originalText);
          await writable.close();
        } catch (rollbackError) {
          rollbackErrors.push(
            `${change.item.filename}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (rollbackErrors.length > 0) {
        throw new Error(`${detail} Rollback also failed for ${rollbackErrors.join(", ")}.`);
      }
      throw new Error(`${detail} Earlier record writes were rolled back.`);
    }

    for (const change of prepared) {
      change.item.data = change.data;
      change.item.rawText = change.text;
      change.item.parseError = null;
    }
  }

  async function saveAssociation(event) {
    event.preventDefault();
    if (!state.selected?.data) {
      return;
    }
    elements.confirmAssociation.disabled = true;
    elements.cancelAssociation.disabled = true;
    elements.associationErrors.hidden = true;
    try {
      const plan = utils.planPlaceAssociation(
        loadedRecordData(),
        state.selected.data.id,
        {
          rootPlaceId: numericInputValue(elements.associationPlaceId),
          universeId: numericInputValue(elements.associationUniverseId),
          name: elements.associationName.value,
          evidenceDetail: elements.associationEvidence.value,
          preferred: elements.associationPreferred.checked,
          oldPreferredRecordId: elements.oldPreferredRecord.value || null,
        },
      );
      await writeAssociationUpdates(plan.updates);
      const selected = state.selected;
      state.originalEditorText = selected.rawText;
      elements.editor.value = selected.rawText;
      elements.entrySummary.textContent = `${selected.data.id} · ${utils.recordStatus(selected.data)} · ${selected.filename}`;
      sortRecords();
      renderRecordList();
      updateEditorButtons();
      elements.associationDialog.close();
      setMessage(
        `Saved the place association and updated ${plan.updates.length} record(s). Generated indexes now need build and verify.`,
        "success",
      );
    } catch (error) {
      elements.associationErrors.textContent = error instanceof Error ? error.message : String(error);
      elements.associationErrors.hidden = false;
    } finally {
      elements.confirmAssociation.disabled = false;
      elements.cancelAssociation.disabled = false;
    }
  }

  function replacementCandidatesForRemoval(record) {
    if (!utils.isPublishableRecord(record) || !record.preferred) {
      return [];
    }
    return state.records.filter(
      (item) =>
        item.data?.id !== record.id &&
        utils.isPublishableRecord(item.data) &&
        item.data.source.root_place_id === record.source.root_place_id,
    );
  }

  function updateRemoveConfirmation() {
    const recordId = state.selected?.data?.id || "";
    const replacementReady =
      elements.replacementPreferredField.hidden ||
      elements.replacementPreferredRecord.value !== "";
    elements.confirmRemove.disabled =
      elements.removeConfirmation.value !== recordId || !replacementReady;
  }

  function openRemoveDialog() {
    if (!state.selected?.data) {
      return;
    }
    if (isDirty()) {
      if (!window.confirm("Discard the unsaved JSON changes before removing this entry?")) {
        return;
      }
      revertEditor();
    }

    const record = state.selected.data;
    const errors = utils.validateRecord(record, {
      expectedId: state.selected.filename.replace(/\.json$/i, ""),
      expectedBlob: record.blob,
    });
    if (errors.length > 0) {
      setMessage(`This entry cannot be safely removed: ${errors.join(" ")}`);
      return;
    }

    elements.removeForm.reset();
    elements.removeErrors.hidden = true;
    elements.removeErrors.textContent = "";
    elements.removeRecord.textContent = `${record.title} (${record.id})`;
    const sharedBlobCount = state.records.filter(
      (item) => item.data?.id !== record.id && item.data?.blob?.path === record.blob.path,
    ).length;
    const blobSummary = sharedBlobCount === 0
      ? `The unshared blob ${record.blob.path} will also be deleted.`
      : `The blob ${record.blob.path} will be retained because ${sharedBlobCount} other record(s) reference it.`;
    const candidates = replacementCandidatesForRemoval(record);
    let placeSummary = "";
    if (utils.isPublishableRecord(record) && record.preferred) {
      placeSummary = candidates.length > 0
        ? ` Choose a new preferred snapshot for place ${record.source.root_place_id}.`
        : ` Place ${record.source.root_place_id} will no longer appear in the generated place index.`;
    }
    elements.removeSummary.textContent =
      `The source record catalog/records/${state.selected.filename} will be deleted. ${blobSummary}${placeSummary}`;

    elements.replacementPreferredField.hidden = candidates.length === 0;
    elements.replacementPreferredRecord.required = candidates.length > 0;
    const options = document.createDocumentFragment();
    if (candidates.length > 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a replacement";
      options.append(placeholder);
      for (const item of candidates) {
        const option = document.createElement("option");
        option.value = item.data.id;
        option.textContent = `${item.data.title} (${item.data.id})`;
        options.append(option);
      }
    }
    elements.replacementPreferredRecord.replaceChildren(options);
    elements.removeConfirmation.placeholder = record.id;
    updateRemoveConfirmation();
    elements.removeDialog.showModal();
  }

  function closeRemoveDialog() {
    elements.removeDialog.close();
  }

  async function removeBlobFile(path) {
    const parts = path.split("/");
    const filename = parts.pop();
    let directory = state.rootDirectory;
    const traversed = [];
    try {
      for (const part of parts) {
        const child = await directory.getDirectoryHandle(part);
        traversed.push({ parent: directory, name: part });
        directory = child;
      }
      await directory.removeEntry(filename);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return;
      }
      throw error;
    }

    const leaf = traversed.at(-1);
    if (leaf) {
      try {
        await leaf.parent.removeEntry(leaf.name);
      } catch (_) {
        // Non-empty content-addressed directories are expected and should be retained.
      }
    }
  }

  async function removeSelectedEntry(event) {
    event.preventDefault();
    const selected = state.selected;
    if (!selected?.data || elements.removeConfirmation.value !== selected.data.id) {
      return;
    }

    elements.confirmRemove.disabled = true;
    elements.cancelRemove.disabled = true;
    elements.removeErrors.hidden = true;
    const rollbackUpdates = [];
    let updatesWritten = false;
    let recordRemoved = false;
    try {
      const plan = utils.planRecordRemoval(
        loadedRecordData(),
        selected.data.id,
        elements.replacementPreferredRecord.value || null,
      );
      for (const update of plan.updates) {
        const item = state.records.find((record) => record.data?.id === update.id);
        rollbackUpdates.push({
          id: update.id,
          record: JSON.parse(JSON.stringify(item.data)),
        });
      }
      await writeAssociationUpdates(plan.updates);
      updatesWritten = true;

      await state.recordsDirectory.removeEntry(selected.filename);
      recordRemoved = true;
      if (plan.removeBlob) {
        await removeBlobFile(selected.data.blob.path);
      }

      state.records = state.records.filter((item) => item !== selected);
      state.selected = null;
      state.originalEditorText = "";
      elements.editor.value = "";
      elements.editor.disabled = true;
      elements.entrySummary.textContent = "Select a record to edit it.";
      setValidationErrors([]);
      elements.removeDialog.close();
      sortRecords();
      renderRecordList();
      updateEditorButtons();
      const blobResult = plan.removeBlob
        ? ` Deleted its unshared blob ${selected.data.blob.path}.`
        : ` Retained the shared blob ${selected.data.blob.path}.`;
      setMessage(
        `Removed ${selected.filename}.${blobResult} Generated indexes now need build and verify.`,
        "success",
      );
    } catch (error) {
      const rollbackErrors = [];
      if (recordRemoved) {
        try {
          const restoredHandle = await state.recordsDirectory.getFileHandle(selected.filename, {
            create: true,
          });
          const writable = await restoredHandle.createWritable();
          await writable.write(selected.rawText);
          await writable.close();
          selected.handle = restoredHandle;
        } catch (rollbackError) {
          rollbackErrors.push(
            `record restore failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      }
      if (updatesWritten && rollbackUpdates.length > 0) {
        try {
          await writeAssociationUpdates(rollbackUpdates);
        } catch (rollbackError) {
          rollbackErrors.push(
            `preferred-record rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      elements.removeErrors.textContent = rollbackErrors.length === 0
        ? `${detail} No entry was removed.`
        : `${detail} Removal rollback was incomplete: ${rollbackErrors.join("; ")}. Reload the repository before continuing.`;
      elements.removeErrors.hidden = false;
    } finally {
      elements.cancelRemove.disabled = false;
      updateRemoveConfirmation();
    }
  }

  function openAddDialog() {
    if (!state.rootDirectory || !confirmDiscard()) {
      return;
    }
    elements.addForm.reset();
    elements.collection.value = "root";
    elements.addDialog.showModal();
  }

  function closeAddDialog() {
    elements.addDialog.close();
  }

  function updateNewEntryDefaults() {
    const file = elements.placeFile.files[0];
    if (!file) {
      return;
    }
    elements.newTitle.value = utils.stripLevelExtension(file.name);
    elements.originalPath.value = file.name;
  }

  function browserXmlValidator(bytes) {
    const xml = new TextDecoder().decode(bytes);
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = documentNode.querySelector("parsererror");
    if (parserError) {
      const message = parserError.textContent.replace(/\s+/g, " ").trim();
      throw new Error(message.slice(0, 240) || "XML parser error");
    }
  }

  async function fileExists(directory, filename) {
    try {
      return await directory.getFileHandle(filename);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }
      throw error;
    }
  }

  async function directoryForPath(root, pathParts) {
    let directory = root;
    for (const part of pathParts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    return directory;
  }

  async function writeBlob(record, bytes) {
    const pathParts = record.blob.path.split("/");
    const filename = pathParts.pop();
    const directory = await directoryForPath(state.rootDirectory, pathParts);
    const existingHandle = await fileExists(directory, filename);
    if (existingHandle) {
      const existingBytes = new Uint8Array(await (await existingHandle.getFile()).arrayBuffer());
      const existingHash = await utils.sha256Hex(existingBytes);
      if (existingHash !== record.blob.sha256) {
        throw new Error(`Existing blob ${record.blob.path} does not match its content hash.`);
      }
      return;
    }
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async function addEntry(event) {
    event.preventDefault();
    const file = elements.placeFile.files[0];
    if (!file || !state.recordsDirectory) {
      return;
    }
    elements.confirmAdd.disabled = true;
    setMessage(`Hashing ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const record = await utils.createRecord({
        bytes,
        title: elements.newTitle.value.trim(),
        originalPath: elements.originalPath.value.trim(),
        collection: elements.collection.value.trim(),
        validateXml: browserXmlValidator,
      });
      const errors = utils.validateRecord(record);
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }
      const filename = `${record.id}.json`;
      if (await fileExists(state.recordsDirectory, filename)) {
        throw new Error(
          `Record ${record.id} already exists. Use a distinct original path if this is a separate snapshot.`,
        );
      }

      setMessage(`Writing ${record.blob.path}…`);
      await writeBlob(record, bytes);
      const text = `${JSON.stringify(record, null, 2)}\n`;
      const handle = await state.recordsDirectory.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();

      const item = { filename, handle, rawText: text, data: record, parseError: null };
      state.records.push(item);
      sortRecords();
      elements.addDialog.close();
      state.selected = null;
      selectRecord(item);
      setMessage(
        `Added ${record.title}. Run discover, enrich, build, and verify from the CLI.`,
        "success",
      );
    } catch (error) {
      setMessage(`Could not add entry: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      elements.confirmAdd.disabled = false;
    }
  }

  function handleRecordClick(event) {
    const button = event.target.closest("button[data-filename]");
    if (!button) {
      return;
    }
    const record = state.records.find((item) => item.filename === button.dataset.filename);
    if (record) {
      selectRecord(record);
    }
  }

  function initialize() {
    if (!("showDirectoryPicker" in window)) {
      elements.browserWarning.hidden = false;
      elements.openRepository.disabled = true;
    }
    elements.openRepository.addEventListener("click", openRepository);
    elements.associatePlace.addEventListener("click", openAssociationDialog);
    elements.cancelAssociation.addEventListener("click", closeAssociationDialog);
    elements.associationForm.addEventListener("submit", saveAssociation);
    elements.associationPlaceId.addEventListener("input", () => {
      const placeId = numericInputValue(elements.associationPlaceId);
      if (placeId !== state.associationPlaceId) {
        state.associationPlaceId = placeId;
        state.associationUniverseManuallyEdited = false;
        state.associationNameManuallyEdited = false;
        elements.associationUniverseId.value = "";
        elements.associationName.value = state.selected?.data?.title || "";
      }
      fillKnownAssociationMetadata();
      renderAssociationContext();
    });
    elements.associationUniverseId.addEventListener("input", () => {
      state.associationUniverseManuallyEdited = true;
    });
    elements.associationName.addEventListener("input", () => {
      state.associationNameManuallyEdited = true;
    });
    elements.useKnownPlace.addEventListener("click", () => {
      fillKnownAssociationMetadata(true);
      state.associationUniverseManuallyEdited = false;
      state.associationNameManuallyEdited = false;
      renderAssociationContext();
    });
    elements.associationPreferred.addEventListener("change", renderAssociationContext);
    elements.removeEntry.addEventListener("click", openRemoveDialog);
    elements.cancelRemove.addEventListener("click", closeRemoveDialog);
    elements.removeForm.addEventListener("submit", removeSelectedEntry);
    elements.removeConfirmation.addEventListener("input", updateRemoveConfirmation);
    elements.replacementPreferredRecord.addEventListener("change", updateRemoveConfirmation);
    elements.newEntry.addEventListener("click", openAddDialog);
    elements.cancelAdd.addEventListener("click", closeAddDialog);
    elements.addForm.addEventListener("submit", addEntry);
    elements.placeFile.addEventListener("change", updateNewEntryDefaults);
    elements.recordList.addEventListener("click", handleRecordClick);
    elements.search.addEventListener("input", renderRecordList);
    elements.filter.addEventListener("change", renderRecordList);
    elements.editor.addEventListener("input", updateEditorButtons);
    elements.save.addEventListener("click", saveSelectedRecord);
    elements.revert.addEventListener("click", revertEditor);
    window.addEventListener("beforeunload", (event) => {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  initialize();
})();
