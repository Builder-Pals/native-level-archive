(function () {
  "use strict";

  const utils = globalThis.RecordUtils;
  const elements = {
    addDialog: document.querySelector("#add-dialog"),
    addForm: document.querySelector("#add-form"),
    associatePlace: document.querySelector("#associate-place"),
    associationDialog: document.querySelector("#association-dialog"),
    associationErrors: document.querySelector("#association-errors"),
    associationForm: document.querySelector("#association-form"),
    associationName: document.querySelector("#association-name"),
    associationPlaceId: document.querySelector("#association-place-id"),
    associationPreferred: document.querySelector("#association-preferred"),
    associationRecord: document.querySelector("#association-record"),
    associationTargetSummary: document.querySelector("#association-target-summary"),
    associationUniverseId: document.querySelector("#association-universe-id"),
    browserWarning: document.querySelector("#browser-warning"),
    cancelAdd: document.querySelector("#cancel-add"),
    cancelAssociation: document.querySelector("#cancel-association"),
    collection: document.querySelector("#collection"),
    confirmAdd: document.querySelector("#confirm-add"),
    confirmAssociation: document.querySelector("#confirm-association"),
    editor: document.querySelector("#editor"),
    entrySummary: document.querySelector("#entry-summary"),
    filter: document.querySelector("#filter"),
    message: document.querySelector("#message"),
    newEntry: document.querySelector("#new-entry"),
    newTitle: document.querySelector("#new-title"),
    openRepository: document.querySelector("#open-repository"),
    originalPath: document.querySelector("#original-path"),
    oldPreferredField: document.querySelector("#old-preferred-field"),
    oldPreferredRecord: document.querySelector("#old-preferred-record"),
    placeFile: document.querySelector("#place-file"),
    recordCount: document.querySelector("#record-count"),
    recordList: document.querySelector("#record-list"),
    repositoryStatus: document.querySelector("#repository-status"),
    revert: document.querySelector("#revert"),
    save: document.querySelector("#save"),
    search: document.querySelector("#search"),
    validationErrors: document.querySelector("#validation-errors"),
  };

  const state = {
    records: [],
    recordsDirectory: null,
    rootDirectory: null,
    selected: null,
    originalEditorText: "",
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

  function renderAssociationContext() {
    if (!state.selected?.data) {
      return;
    }
    const newPlaceId = numericInputValue(elements.associationPlaceId);
    const targetRecords = Number.isSafeInteger(newPlaceId)
      ? associationRecordsForPlace(newPlaceId, true)
      : [];
    const targetPreferred = targetRecords.find((item) => item.data.preferred);
    if (targetRecords.length === 0) {
      elements.associationTargetSummary.textContent =
        "No other publishable snapshots currently use this place ID.";
    } else if (elements.associationPreferred.checked) {
      elements.associationTargetSummary.textContent = targetPreferred
        ? `${targetRecords.length} other snapshot(s) use this place ID. ${targetPreferred.data.title} will no longer be preferred.`
        : `${targetRecords.length} other snapshot(s) use this place ID; none is currently preferred.`;
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
    const existingTarget = record.source
      ? associationRecordsForPlace(record.source.root_place_id, true)
      : [];
    elements.associationPreferred.checked = record.source
      ? record.preferred || !existingTarget.some((item) => item.data.preferred)
      : true;
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
        state.records.filter((item) => item.data).map((item) => item.data),
        state.selected.data.id,
        {
          rootPlaceId: numericInputValue(elements.associationPlaceId),
          universeId: numericInputValue(elements.associationUniverseId),
          name: elements.associationName.value,
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
    elements.associationPlaceId.addEventListener("input", renderAssociationContext);
    elements.associationPreferred.addEventListener("change", renderAssociationContext);
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
