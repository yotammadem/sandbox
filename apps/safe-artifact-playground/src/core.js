const STANDARD_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "dateTime",
]);

const VIEW_KEYS = {
  stack: new Set(["kind", "gap", "children"]),
  grid: new Set(["kind", "columns", "gap", "children"]),
  section: new Set(["kind", "title", "tone", "children"]),
  heading: new Set(["kind", "level", "value"]),
  text: new Set(["kind", "value", "emphasis", "tone"]),
  code: new Set(["kind", "value"]),
  number: new Set(["kind", "value", "label"]),
  boolean: new Set(["kind", "value", "label"]),
  dateTime: new Set(["kind", "value", "label"]),
  list: new Set(["kind", "items", "ordered", "label"]),
  keyValue: new Set(["kind", "entries"]),
  table: new Set(["kind", "rows", "columns"]),
  json: new Set(["kind", "value"]),
  divider: new Set(["kind"]),
};

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

function issue(path, message) {
  return { path: path || "/", message };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointerPart(part) {
  return String(part).replaceAll("~", "~0").replaceAll("/", "~1");
}

function joinPointer(base, part) {
  return `${base}/${escapePointerPart(part)}`;
}

function decodePointer(path) {
  if (path === "") return [];
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  return path
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function isDateTime(value) {
  if (typeof value !== "string") return false;
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function validateSchemaNode(schema, path, errors) {
  if (!isPlainObject(schema)) {
    errors.push(issue(path, "Schema node must be an object."));
    return;
  }

  if (!STANDARD_TYPES.has(schema.type)) {
    errors.push(issue(`${path}/type`, `Unsupported schema type: ${String(schema.type)}.`));
    return;
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    errors.push(issue(`${path}/enum`, "enum must be an array."));
  }

  if (schema.type === "object") {
    if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
      errors.push(issue(`${path}/properties`, "properties must be an object."));
    } else {
      for (const [name, child] of Object.entries(schema.properties ?? {})) {
        validateSchemaNode(child, `${path}/properties/${escapePointerPart(name)}`, errors);
      }
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((x) => typeof x !== "string"))) {
      errors.push(issue(`${path}/required`, "required must be an array of property names."));
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
      errors.push(issue(`${path}/additionalProperties`, "POC supports only boolean additionalProperties."));
    }
  }

  if (schema.type === "array") {
    if (!schema.items) {
      errors.push(issue(`${path}/items`, "Array schemas require items."));
    } else {
      validateSchemaNode(schema.items, `${path}/items`, errors);
    }
  }
}

function validateBinding(binding, path, errors) {
  if (!isPlainObject(binding) || typeof binding.path !== "string" || decodePointer(binding.path) === null) {
    errors.push(issue(path, "Binding must be an object with a valid JSON Pointer path."));
  }
}

function validateViewNode(node, path, errors) {
  if (!isPlainObject(node) || typeof node.kind !== "string" || !VIEW_KEYS[node.kind]) {
    errors.push(issue(path, `Unsupported view component: ${String(node?.kind)}.`));
    return;
  }

  for (const key of Object.keys(node)) {
    if (!VIEW_KEYS[node.kind].has(key)) {
      errors.push(issue(`${path}/${key}`, `Property is not allowed on ${node.kind}.`));
    }
  }

  if (["stack", "grid", "section"].includes(node.kind)) {
    if (!Array.isArray(node.children)) {
      errors.push(issue(`${path}/children`, `${node.kind} requires a children array.`));
    } else {
      node.children.forEach((child, index) => validateViewNode(child, `${path}/children/${index}`, errors));
    }
  }

  if (node.gap !== undefined && !["none", "small", "medium", "large"].includes(node.gap)) {
    errors.push(issue(`${path}/gap`, "gap must be none, small, medium, or large."));
  }

  if (node.kind === "grid" && (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > 4)) {
    errors.push(issue(`${path}/columns`, "grid columns must be an integer from 1 through 4."));
  }

  if (node.kind === "section" && typeof node.title !== "string") {
    errors.push(issue(`${path}/title`, "section requires a visible title."));
  }

  if (node.tone !== undefined && !["neutral", "info", "success", "warning", "danger"].includes(node.tone)) {
    errors.push(issue(`${path}/tone`, "tone is not a supported semantic token."));
  }

  if (node.emphasis !== undefined && !["normal", "lead", "muted"].includes(node.emphasis)) {
    errors.push(issue(`${path}/emphasis`, "emphasis is not a supported semantic token."));
  }

  if (["heading", "text", "code", "number", "boolean", "dateTime", "json"].includes(node.kind)) {
    validateBinding(node.value, `${path}/value`, errors);
  }

  if (node.kind === "heading" && (!Number.isInteger(node.level) || node.level < 1 || node.level > 6)) {
    errors.push(issue(`${path}/level`, "Heading level must be between 1 and 6."));
  }

  if (node.kind === "list") validateBinding(node.items, `${path}/items`, errors);

  if (node.kind === "list" && node.ordered !== undefined && typeof node.ordered !== "boolean") {
    errors.push(issue(`${path}/ordered`, "ordered must be a boolean."));
  }

  if (["number", "boolean", "dateTime", "list"].includes(node.kind) && node.label !== undefined && typeof node.label !== "string") {
    errors.push(issue(`${path}/label`, "label must be a visible string."));
  }

  if (node.kind === "keyValue") {
    if (!Array.isArray(node.entries)) {
      errors.push(issue(`${path}/entries`, "keyValue requires entries."));
    } else {
      node.entries.forEach((entry, index) => {
        if (!isPlainObject(entry) || typeof entry.label !== "string") {
          errors.push(issue(`${path}/entries/${index}`, "Entry requires a string label."));
        } else {
          validateBinding(entry.value, `${path}/entries/${index}/value`, errors);
        }
      });
    }
  }

  if (node.kind === "table") {
    validateBinding(node.rows, `${path}/rows`, errors);
    if (!Array.isArray(node.columns) || node.columns.length === 0) {
      errors.push(issue(`${path}/columns`, "table requires at least one column."));
    } else {
      node.columns.forEach((column, index) => {
        if (!isPlainObject(column) || typeof column.header !== "string") {
          errors.push(issue(`${path}/columns/${index}`, "Column requires a string header."));
        } else {
          validateBinding(column.value, `${path}/columns/${index}/value`, errors);
        }
      });
    }
  }
}

export function validateTypeDefinition(definition) {
  const errors = [];
  if (!isPlainObject(definition)) return [issue("/", "Type Definition must be an object.")];

  if (definition.kind !== "safeartifact/type-definition") errors.push(issue("/kind", "Invalid Type Definition kind."));
  if (definition.specVersion !== "0.1") errors.push(issue("/specVersion", "POC supports specVersion 0.1."));
  if (typeof definition.name !== "string" || !definition.name) errors.push(issue("/name", "Type name is required."));
  if (typeof definition.version !== "string" || !definition.version) errors.push(issue("/version", "Type version is required."));

  validateSchemaNode(definition.contentSchema, "/contentSchema", errors);
  validateViewNode(definition.view, "/view", errors);
  return errors;
}

function matchesEnum(value, choices) {
  return choices.some((choice) => JSON.stringify(choice) === JSON.stringify(value));
}

function validateValue(value, schema, path, errors) {
  if (Array.isArray(schema.enum) && !matchesEnum(value, schema.enum)) {
    errors.push(issue(path, `Value must be one of: ${schema.enum.map(String).join(", ")}.`));
    return;
  }

  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const expected = schema.type;
  const typeMatches =
    (expected === "integer" && Number.isInteger(value)) ||
    (expected === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (expected === "object" && isPlainObject(value)) ||
    (expected === "array" && Array.isArray(value)) ||
    (expected === "null" && value === null) ||
    (expected === "dateTime" && typeof value === "string") ||
    expected === actualType;

  if (!typeMatches) {
    errors.push(issue(path, `Expected ${expected}, received ${actualType}.`));
    return;
  }

  if (expected === "dateTime" && !isDateTime(value)) {
    errors.push(issue(path, "Expected canonical UTC dateTime: YYYY-MM-DDTHH:mm:ss[.fraction]Z."));
  }

  if (expected === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(issue(path, `String is shorter than ${schema.minLength}.`));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(issue(path, `String is longer than ${schema.maxLength}.`));
  }

  if (expected === "number" || expected === "integer") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(issue(path, `Number must be at least ${schema.minimum}.`));
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(issue(path, `Number must be at most ${schema.maximum}.`));
  }

  if (expected === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(issue(path, `Array requires at least ${schema.minItems} items.`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(issue(path, `Array allows at most ${schema.maxItems} items.`));
    value.forEach((item, index) => validateValue(item, schema.items, joinPointer(path, index), errors));
  }

  if (expected === "object") {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(issue(joinPointer(path, required), "Required property is missing."));
    }
    for (const [name, child] of Object.entries(value)) {
      if (schema.properties?.[name]) {
        validateValue(child, schema.properties[name], joinPointer(path, name), errors);
      } else if (schema.additionalProperties === false) {
        errors.push(issue(joinPointer(path, name), "Additional property is not allowed."));
      }
    }
  }
}

export function validateArtifact(artifact, definition) {
  const errors = [];
  if (!isPlainObject(artifact)) return [issue("/", "Artifact must be an object.")];

  const allowed = new Set(["specVersion", "id", "type", "title", "createdAt", "producer", "expiresAt", "content"]);
  for (const key of Object.keys(artifact)) {
    if (!allowed.has(key)) errors.push(issue(`/${key}`, "Unknown artifact field."));
  }

  if (artifact.specVersion !== "0.1") errors.push(issue("/specVersion", "POC supports specVersion 0.1."));
  if (typeof artifact.id !== "string" || !artifact.id) errors.push(issue("/id", "Artifact ID is required."));
  if (typeof artifact.title !== "string" || !artifact.title) errors.push(issue("/title", "Artifact title is required."));
  if (!isDateTime(artifact.createdAt)) errors.push(issue("/createdAt", "createdAt must be a canonical SafeArtifact dateTime."));
  if (artifact.expiresAt !== undefined && !isDateTime(artifact.expiresAt)) errors.push(issue("/expiresAt", "expiresAt must be a canonical SafeArtifact dateTime."));
  if (artifact.producer !== undefined && typeof artifact.producer !== "string") errors.push(issue("/producer", "producer must be a string."));

  if (!isPlainObject(artifact.type)) {
    errors.push(issue("/type", "Artifact type reference is required."));
  } else {
    if (artifact.type.name !== definition.name) errors.push(issue("/type/name", `Expected ${definition.name}.`));
    if (artifact.type.version !== definition.version) errors.push(issue("/type/version", `Expected ${definition.version}.`));
    if (typeof artifact.type.digest !== "string" || !artifact.type.digest.startsWith("sha256-")) {
      errors.push(issue("/type/digest", "A sha256- digest reference is required."));
    }
  }

  if (!Object.hasOwn(artifact, "content")) {
    errors.push(issue("/content", "Artifact content is required."));
  } else {
    validateValue(artifact.content, definition.contentSchema, "/content", errors);
  }
  return errors;
}

function resolveBinding(binding, context) {
  const parts = decodePointer(binding.path);
  if (parts === null) return { error: "Invalid JSON Pointer." };

  let value = context.value;
  let pointer = context.pointer;
  for (const part of parts) {
    if ((isPlainObject(value) || Array.isArray(value)) && Object.hasOwn(value, part)) {
      value = value[part];
      pointer = joinPointer(pointer, part);
    } else {
      return { error: `Path ${binding.path || "/"} does not exist from ${context.pointer || "/content"}.` };
    }
  }
  return { value, pointer };
}

function collectStringPaths(value, pointer, output) {
  if (typeof value === "string") {
    output.add(pointer);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringPaths(item, joinPointer(pointer, index), output));
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) collectStringPaths(child, joinPointer(pointer, key), output);
  }
}

function markValue(value, pointer, covered) {
  if (typeof value === "string") covered.add(pointer);
}

function buildNode(node, context, covered, errors, viewPath) {
  if (["stack", "grid", "section"].includes(node.kind)) {
    return {
      kind: node.kind,
      title: node.title,
      tone: node.tone,
      columns: node.columns,
      gap: node.gap,
      children: node.children.map((child, index) => buildNode(child, context, covered, errors, `${viewPath}/children/${index}`)),
    };
  }

  if (node.kind === "divider") return { kind: "divider" };

  if (["heading", "text", "code", "number", "boolean", "dateTime"].includes(node.kind)) {
    const resolved = resolveBinding(node.value, context);
    if (resolved.error) {
      errors.push(issue(`${viewPath}/value`, resolved.error));
      return { kind: "error", message: resolved.error };
    }
    markValue(resolved.value, resolved.pointer, covered);
    return { ...node, value: resolved.value, sourcePath: resolved.pointer };
  }

  if (node.kind === "json") {
    const resolved = resolveBinding(node.value, context);
    if (resolved.error) {
      errors.push(issue(`${viewPath}/value`, resolved.error));
      return { kind: "error", message: resolved.error };
    }
    collectStringPaths(resolved.value, resolved.pointer, covered);
    return { kind: "json", value: resolved.value };
  }

  if (node.kind === "list") {
    const resolved = resolveBinding(node.items, context);
    if (resolved.error || !Array.isArray(resolved.value)) {
      const message = resolved.error ?? "List binding must resolve to an array.";
      errors.push(issue(`${viewPath}/items`, message));
      return { kind: "error", message };
    }
    const items = resolved.value.map((value, index) => {
      const pointer = joinPointer(resolved.pointer, index);
      markValue(value, pointer, covered);
      return { value, pointer };
    });
    return { ...node, items };
  }

  if (node.kind === "keyValue") {
    const entries = node.entries.map((entry, index) => {
      const resolved = resolveBinding(entry.value, context);
      if (resolved.error) {
        errors.push(issue(`${viewPath}/entries/${index}/value`, resolved.error));
        return { label: entry.label, value: "Binding error" };
      }
      markValue(resolved.value, resolved.pointer, covered);
      return { label: entry.label, value: resolved.value };
    });
    return { kind: "keyValue", entries };
  }

  if (node.kind === "table") {
    const resolved = resolveBinding(node.rows, context);
    if (resolved.error || !Array.isArray(resolved.value)) {
      const message = resolved.error ?? "Table rows must resolve to an array.";
      errors.push(issue(`${viewPath}/rows`, message));
      return { kind: "error", message };
    }
    const rows = resolved.value.map((row, rowIndex) => {
      const rowContext = { value: row, pointer: joinPointer(resolved.pointer, rowIndex) };
      return node.columns.map((column, columnIndex) => {
        const cell = resolveBinding(column.value, rowContext);
        if (cell.error) {
          errors.push(issue(`${viewPath}/columns/${columnIndex}/value`, `${cell.error} (row ${rowIndex + 1})`));
          return { value: "Binding error" };
        }
        markValue(cell.value, cell.pointer, covered);
        return { value: cell.value, pointer: cell.pointer };
      });
    });
    return { kind: "table", columns: node.columns.map((column) => column.header), rows };
  }

  errors.push(issue(viewPath, `Renderer does not support ${node.kind}.`));
  return { kind: "error", message: `Unsupported component ${node.kind}` };
}

export function buildViewModel(content, view) {
  const covered = new Set();
  const errors = [];
  const model = buildNode(view, { value: content, pointer: "/content" }, covered, errors, "/view");
  const obligations = new Set();
  collectStringPaths(content, "/content", obligations);
  const missing = [...obligations].filter((path) => !covered.has(path));
  return { model, errors, missing, covered: [...covered] };
}

export function parseJson(source, label) {
  try {
    return { value: JSON.parse(source), errors: [] };
  } catch (error) {
    return { value: null, errors: [issue("/", `${label} is not valid JSON: ${error.message}`)] };
  }
}
