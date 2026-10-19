"use strict";

const { RESOURCES } = require("./schemas");

const IMAGE_PATH = /^(assets|uploads)\/[A-Za-z0-9_\-. \/]+\.(jpe?g|png|webp|avif|gif)$/i;

function clean(str, multiline) {
  let v = String(str).replace(/\r\n?/g, "\n");
  // Strip control characters (keep \n for multi-line text, tab -> space).
  v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\t/g, " ");
  if (!multiline) v = v.replace(/\n+/g, " ");
  return v.trim();
}

function isEmpty(v) {
  return v === undefined || v === null || v === "";
}

function validateField(f, v, path, ctx, errors) {
  const fail = (message) => errors.push({ path, message });

  switch (f.type) {
    case "string":
    case "text": {
      const out = isEmpty(v) ? "" : clean(v, f.type === "text");
      if (f.required && !out) fail(`${f.label} is required`);
      const max = f.max || (f.type === "text" ? 4000 : 200);
      if (out.length > max) fail(`${f.label} must be at most ${max} characters`);
      if (out && f.pattern && !new RegExp(f.pattern).test(out)) fail(f.patternMsg || `${f.label} is not in the expected format`);
      return out;
    }

    case "number": {
      if (isEmpty(v)) {
        if (f.required) fail(`${f.label} is required`);
        return null;
      }
      const num = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
      if (!Number.isFinite(num)) { fail(`${f.label} must be a number`); return null; }
      if (f.integer && !Number.isInteger(num)) fail(`${f.label} must be a whole number`);
      if (f.min !== undefined && num < f.min) fail(`${f.label} must be at least ${f.min}`);
      if (f.max !== undefined && num > f.max) fail(`${f.label} must be at most ${f.max}`);
      // Avoid float noise like 12.610000000000001
      return f.integer ? num : Math.round(num * 1e6) / 1e6;
    }

    case "boolean":
      return v === true || v === "true" || v === 1 || v === "1" || v === "on";

    case "select": {
      const out = isEmpty(v) ? "" : String(v);
      if (f.required && !out) fail(`${f.label} is required`);
      if (out && !f.options.some((o) => o.value === out)) fail(`${f.label} has an invalid value`);
      return out;
    }

    case "ref": {
      const out = isEmpty(v) ? "" : String(v);
      if (f.required && !out) fail(`${f.label} is required`);
      if (out && ctx.refExists && !ctx.refExists(f.ref, out)) fail(`${f.label} refers to something that doesn't exist`);
      return out;
    }

    case "image": {
      const out = isEmpty(v) ? "" : String(v).trim();
      if (f.required && !out) fail(`${f.label} is required`);
      if (out && (!IMAGE_PATH.test(out) || out.includes(".."))) fail(`${f.label} must be an image from the media library`);
      return out;
    }

    case "list": {
      const arr = Array.isArray(v) ? v : isEmpty(v) ? [] : null;
      if (arr === null) { fail(`${f.label} must be a list`); return []; }
      if (f.minItems && arr.length < f.minItems) fail(`${f.label} needs at least ${f.minItems} item${f.minItems > 1 ? "s" : ""}`);
      if (f.maxItems && arr.length > f.maxItems) fail(`${f.label} can have at most ${f.maxItems} items`);
      const items = [];
      arr.slice(0, f.maxItems ? f.maxItems + 1 : 500).forEach((item, i) => {
        const p = `${path}[${i}]`;
        if (f.of === "object") {
          items.push(validateObject(f.fields, item, p, ctx, errors));
        } else {
          const scalar = { type: f.of, label: f.label, max: f.itemMax, required: true };
          const out = validateField(scalar, item, p, ctx, errors);
          items.push(out);
        }
      });
      // Scalar lists silently drop blank rows rather than erroring on them.
      return f.of === "object" ? items : items.filter((x) => x !== "");
    }

    case "object":
      return validateObject(f.fields, v, path, ctx, errors);

    default:
      return v;
  }
}

function validateObject(fields, input, path, ctx, errors) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const f of fields) {
    const p = path ? `${path}.${f.key}` : f.key;
    out[f.key] = validateField(f, src[f.key], p, ctx, errors);
  }
  return out;
}

/**
 * Validate and normalise `input` against a resource schema.
 * Returns { value, errors }. Unknown keys are dropped.
 */
function validateResource(type, input, ctx = {}) {
  const spec = RESOURCES[type];
  if (!spec) throw new Error("Unknown resource " + type);
  const errors = [];
  const value = validateObject(spec.fields, input, "", ctx, errors);
  return { value, errors };
}

function titleOf(type, data) {
  const spec = RESOURCES[type];
  if (!spec) return "";
  if (!spec.titleTemplate) return spec.label;
  const text = spec.titleTemplate
    .replace(/\{(\w+)\}/g, (_, k) => (data && data[k] != null ? String(data[k]) : ""))
    .replace(/^\s*—\s*/, "")
    .replace(/\s*—\s*$/, "")
    .trim();
  return text || "(untitled)";
}

module.exports = { validateResource, titleOf, IMAGE_PATH };
