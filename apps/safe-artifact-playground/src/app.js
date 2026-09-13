import {
  buildViewModel,
  parseJson,
  validateArtifact,
  validateTypeDefinition,
} from "./core.js";
import { examples } from "./examples.js";

const elements = {
  workspace: document.querySelector(".workspace"),
  example: document.querySelector("#example-select"),
  artifact: document.querySelector("#artifact-select"),
  typeEditor: document.querySelector("#type-editor"),
  artifactEditor: document.querySelector("#artifact-editor"),
  preview: document.querySelector("#preview"),
  validation: document.querySelector("#validation"),
  status: document.querySelector("#status-pill"),
  formatType: document.querySelector("#format-type"),
  formatArtifact: document.querySelector("#format-artifact"),
  reset: document.querySelector("#reset-example"),
  mobileButtons: [...document.querySelectorAll("[data-pane]")],
};

let currentExample = examples[0];
let updateTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stringify(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderIssues(container, groups) {
  container.replaceChildren();
  const total = groups.reduce((sum, group) => sum + group.issues.length, 0);
  if (total === 0) {
    const ok = element("div", "validation-ok");
    ok.append(element("span", "validation-icon", "✓"), element("span", "", "Type Definition and artifact are valid."));
    container.append(ok);
    return;
  }

  for (const group of groups) {
    if (group.issues.length === 0) continue;
    const section = element("section", "issue-group");
    section.append(element("h4", "", group.label));
    const list = element("ul", "issue-list");
    for (const problem of group.issues) {
      const item = element("li");
      item.append(element("code", "issue-path", problem.path), document.createTextNode(` ${problem.message}`));
      list.append(item);
    }
    section.append(list);
    container.append(section);
  }
}

function renderDateTime(value) {
  const wrapper = element("div", "date-time-value");
  let localized = "Invalid date-time";
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    localized = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date);
  }
  wrapper.append(element("span", "date-time-local", localized), element("code", "date-time-source", value));
  return wrapper;
}

function renderModel(model) {
  if (!model) return element("div", "render-error", "Nothing to render.");

  if (["stack", "grid", "section"].includes(model.kind)) {
    const node = element(model.kind === "section" ? "section" : "div", `sa-${model.kind}`);
    if (model.kind === "grid" && Number.isInteger(model.columns) && model.columns >= 1 && model.columns <= 4) {
      node.dataset.columns = String(model.columns);
    }
    if (model.gap) node.dataset.gap = model.gap;
    if (model.tone) node.dataset.tone = model.tone;
    if (model.kind === "section") node.append(element("h3", "section-title", model.title));
    for (const child of model.children) node.append(renderModel(child));
    return node;
  }

  if (model.kind === "divider") return element("hr", "sa-divider");
  if (model.kind === "error") return element("div", "render-error", model.message);

  if (model.kind === "heading") {
    return element(`h${model.level}`, "artifact-heading", stringify(model.value));
  }

  if (model.kind === "text") {
    const node = element("p", "artifact-text", stringify(model.value));
    if (model.emphasis) node.dataset.emphasis = model.emphasis;
    if (model.tone) node.dataset.tone = model.tone;
    return node;
  }

  if (model.kind === "code") return element("pre", "artifact-code", stringify(model.value));

  if (["number", "boolean"].includes(model.kind)) {
    const card = element("div", "metric-card");
    if (model.label) card.append(element("span", "metric-label", model.label));
    card.append(element("strong", "metric-value", stringify(model.value)));
    return card;
  }

  if (model.kind === "dateTime") {
    const card = element("div", "date-time-card");
    if (model.label) card.append(element("span", "metric-label", model.label));
    card.append(renderDateTime(stringify(model.value)));
    return card;
  }

  if (model.kind === "list") {
    const wrapper = element("div", "list-block");
    if (model.label) wrapper.append(element("h4", "field-label", model.label));
    const list = element(model.ordered ? "ol" : "ul", "artifact-list");
    for (const item of model.items) list.append(element("li", "", stringify(item.value)));
    wrapper.append(list);
    return wrapper;
  }

  if (model.kind === "keyValue") {
    const list = element("dl", "key-value-list");
    for (const entry of model.entries) {
      list.append(element("dt", "", entry.label), element("dd", "", stringify(entry.value)));
    }
    return list;
  }

  if (model.kind === "table") {
    const scroll = element("div", "table-scroll");
    const table = element("table", "artifact-table");
    const head = element("thead");
    const headRow = element("tr");
    model.columns.forEach((header) => headRow.append(element("th", "", header)));
    head.append(headRow);
    const body = element("tbody");
    if (model.rows.length === 0) {
      const row = element("tr");
      const cell = element("td", "empty-cell", "No items");
      cell.colSpan = model.columns.length;
      row.append(cell);
      body.append(row);
    } else {
      for (const rowModel of model.rows) {
        const row = element("tr");
        for (const cellModel of rowModel) {
          const cell = element("td");
          const value = stringify(cellModel.value);
          if (["healthy", "degraded", "down"].includes(value)) {
            const badge = element("span", "status-badge", value);
            badge.dataset.status = value;
            cell.append(badge);
          } else {
            cell.textContent = value;
          }
          row.append(cell);
        }
        body.append(row);
      }
    }
    table.append(head, body);
    scroll.append(table);
    return scroll;
  }

  if (model.kind === "timeBarChart") {
    const chart = element("section", "time-chart");
    if (model.tone) chart.dataset.tone = model.tone;
    const header = element("header", "time-chart-header");
    header.append(
      element("h3", "", model.title),
      element("span", "time-chart-bucket", `${model.bucket.size} ${model.bucket.unit}${model.bucket.size === 1 ? "" : "s"} per bar`),
    );
    chart.append(header);

    if (model.points.length === 0) {
      chart.append(element("p", "time-chart-empty", "No time buckets"));
      return chart;
    }

    const max = Math.max(...model.points.map((point) => point.value), 0);
    const scroll = element("div", "time-chart-scroll");
    const plot = element("div", "time-chart-plot");
    for (const point of model.points) {
      const column = element("div", "time-bar-column");
      column.append(element("strong", "time-bar-value", stringify(point.value)));
      const track = element("div", "time-bar-track");
      const bar = element("div", "time-bar");
      const percentage = max === 0 ? 0 : Math.max(3, (point.value / max) * 100);
      bar.style.setProperty("--bar-height", `${Math.min(100, percentage)}%`);
      track.append(bar);
      const date = new Date(point.time);
      const local = Number.isNaN(date.valueOf())
        ? "Invalid date-time"
        : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
      column.append(track, element("span", "time-bar-local", local), element("code", "time-bar-source", point.time));
      plot.append(column);
    }
    scroll.append(plot);
    chart.append(scroll);
    return chart;
  }

  if (model.kind === "json") return element("pre", "artifact-code", JSON.stringify(model.value, null, 2));
  return element("div", "render-error", `Unknown render node: ${model.kind}`);
}

function renderMetadata(artifact) {
  const header = element("header", "artifact-header");
  const eyebrow = element("div", "artifact-eyebrow", `${artifact.type.name} · v${artifact.type.version}`);
  header.append(eyebrow, element("h2", "artifact-title", artifact.title));

  const metadata = element("dl", "artifact-metadata");
  const fields = [
    ["Spec version", artifact.specVersion],
    ["Artifact ID", artifact.id],
    ["Created", artifact.createdAt],
    ["Type digest", artifact.type.digest],
  ];
  if (artifact.producer) fields.push(["Producer", artifact.producer]);
  if (artifact.expiresAt) fields.push(["Expires", artifact.expiresAt]);
  for (const [label, value] of fields) {
    metadata.append(element("dt", "", label), element("dd", "", value));
  }
  header.append(metadata);
  return header;
}

function renderFallback(artifact, reasons) {
  const notice = element("div", "fallback-notice");
  notice.append(element("strong", "", "Canonical fallback"));
  const detail = reasons.length === 1 ? reasons[0] : `${reasons.length} view safety checks failed.`;
  notice.append(element("span", "", detail));
  const pre = element("pre", "canonical-json", JSON.stringify(artifact.content, null, 2));
  elements.preview.replaceChildren(renderMetadata(artifact), notice, pre);
}

function refresh() {
  const parsedType = parseJson(elements.typeEditor.value, "Type Definition");
  const parsedArtifact = parseJson(elements.artifactEditor.value, "Artifact");
  const typeIssues = [...parsedType.errors];
  const artifactIssues = [...parsedArtifact.errors];
  const viewIssues = [];

  if (typeIssues.length === 0) typeIssues.push(...validateTypeDefinition(parsedType.value));
  if (typeIssues.length === 0 && artifactIssues.length === 0) {
    artifactIssues.push(...validateArtifact(parsedArtifact.value, parsedType.value));
  }

  if (typeIssues.length || artifactIssues.length) {
    elements.preview.replaceChildren(
      element("div", "empty-preview-icon", "{ }") ,
      element("h2", "empty-preview-title", "Waiting for valid input"),
      element("p", "empty-preview-copy", "Fix the validation errors to render this artifact."),
    );
    elements.status.textContent = "Invalid";
    elements.status.dataset.state = "error";
    renderIssues(elements.validation, [
      { label: "Type Definition", issues: typeIssues },
      { label: "Artifact", issues: artifactIssues },
      { label: "View and coverage", issues: viewIssues },
    ]);
    return;
  }

  const result = buildViewModel(parsedArtifact.value.content, parsedType.value.view);
  viewIssues.push(...result.errors);
  viewIssues.push(...result.missing.map((path) => ({ path, message: "Text is not visibly rendered by the View Definition." })));

  if (viewIssues.length) {
    const reasons = [
      ...result.errors.map((problem) => `${problem.path}: ${problem.message}`),
      ...result.missing.map((path) => `${path} is not visible.`),
    ];
    renderFallback(parsedArtifact.value, reasons);
    elements.status.textContent = "Safe fallback";
    elements.status.dataset.state = "warning";
  } else {
    const body = element("div", "artifact-body");
    body.append(renderModel(result.model));
    elements.preview.replaceChildren(renderMetadata(parsedArtifact.value), body);
    elements.status.textContent = "Valid · fully visible";
    elements.status.dataset.state = "success";
  }

  renderIssues(elements.validation, [
    { label: "Type Definition", issues: typeIssues },
    { label: "Artifact", issues: artifactIssues },
    { label: "View and coverage", issues: viewIssues },
  ]);
}

function scheduleRefresh() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(refresh, 180);
}

function fillArtifactOptions() {
  elements.artifact.replaceChildren();
  currentExample.artifacts.forEach((artifact, index) => {
    const option = element("option", "", artifact.label);
    option.value = String(index);
    elements.artifact.append(option);
  });
}

function loadExample(exampleIndex = 0, artifactIndex = 0) {
  currentExample = examples[exampleIndex];
  fillArtifactOptions();
  elements.artifact.value = String(artifactIndex);
  elements.typeEditor.value = JSON.stringify(currentExample.definition, null, 2);
  elements.artifactEditor.value = JSON.stringify(currentExample.artifacts[artifactIndex].value, null, 2);
  refresh();
}

function formatEditor(editor, label) {
  const parsed = parseJson(editor.value, label);
  if (parsed.errors.length === 0) editor.value = JSON.stringify(parsed.value, null, 2);
  refresh();
}

examples.forEach((example, index) => {
  const option = element("option", "", example.label);
  option.value = String(index);
  elements.example.append(option);
});

elements.example.addEventListener("change", () => loadExample(Number(elements.example.value), 0));
elements.artifact.addEventListener("change", () => {
  const artifact = currentExample.artifacts[Number(elements.artifact.value)];
  elements.artifactEditor.value = JSON.stringify(artifact.value, null, 2);
  refresh();
});
elements.typeEditor.addEventListener("input", scheduleRefresh);
elements.artifactEditor.addEventListener("input", scheduleRefresh);
elements.formatType.addEventListener("click", () => formatEditor(elements.typeEditor, "Type Definition"));
elements.formatArtifact.addEventListener("click", () => formatEditor(elements.artifactEditor, "Artifact"));
elements.reset.addEventListener("click", () => loadExample(Number(elements.example.value), Number(elements.artifact.value)));

for (const button of elements.mobileButtons) {
  button.addEventListener("click", () => {
    const pane = button.dataset.pane;
    elements.workspace.dataset.mobilePane = pane;
    elements.mobileButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  });
}

loadExample();
