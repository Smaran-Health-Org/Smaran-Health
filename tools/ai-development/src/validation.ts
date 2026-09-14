import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { isAlias, isMap, isNode, isScalar, isSeq, parseAllDocuments } from "yaml";
import type { ValidateFunction } from "ajv";
import { InputError, readPipelineBytes } from "./paths.js";

export const MAX_YAML_BYTES = 65_536;
export const MAX_ARTIFACT_BYTES = 1_048_576;
export const MAX_DEPTH = 32;

export function parseRestrictedYaml(bytes: Uint8Array, maxBytes = MAX_YAML_BYTES, maxDepth = MAX_DEPTH): unknown {
  if (bytes.byteLength > Math.min(maxBytes, MAX_YAML_BYTES)) throw new InputError("YAML exceeds the configured byte limit.");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new InputError("YAML must be valid UTF-8."); }
  // Directives can change parsing semantics; V1 accepts only YAML 1.2 core.
  if (/^%/m.test(source)) throw new InputError("YAML directives are not supported.");
  let documents;
  try { documents = parseAllDocuments(source, { version: "1.2", schema: "core", uniqueKeys: true, strict: true, prettyErrors: false }); }
  catch { throw new InputError("Malformed YAML; check syntax and indentation."); }
  if (documents.length !== 1) throw new InputError("Expected exactly one YAML document.");
  const document = documents[0]!;
  if (document.errors.length) {
    const code = document.errors[0]!.code;
    throw new InputError(code === "DUPLICATE_KEY" ? "YAML contains a duplicate mapping key." : "Malformed YAML; check syntax and indentation.");
  }
  if (document.warnings.length) throw new InputError("YAML contains unsupported tags or parsing warnings.");
  function check(node: unknown, depth: number): void {
    if (depth > Math.min(maxDepth, MAX_DEPTH)) throw new InputError("YAML exceeds the configured nesting limit.");
    if (isAlias(node)) throw new InputError("YAML aliases are not supported.");
    if (isNode(node) && (node.anchor || node.tag)) throw new InputError("YAML anchors and explicit tags are not supported.");
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new InputError("YAML mapping keys must be strings.");
        if (pair.key.value === "<<") throw new InputError("YAML merge keys are not supported.");
        check(pair.key, depth + 1);
        check(pair.value, depth + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) check(item, depth + 1);
    } else if (isScalar(node) && typeof node.value === "number" && !Number.isFinite(node.value)) {
      throw new InputError("YAML numbers must be finite.");
    }
  }
  check(document.contents, 0);
  return document.toJS({ maxAliasCount: 0 });
}

export function createSchemaValidator<T>(schema: object): ValidateFunction<T> {
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  // ajv-formats is a CommonJS callable with ESM typings that vary by module resolver.
  const addFormats = formats as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  return ajv.compile<T>(schema);
}

export async function loadSchemaValidator<T>(repoRoot: string, name: "config" | "state"): Promise<ValidateFunction<T>> {
  const bytes = await readPipelineBytes(repoRoot, `.ai-development/schemas/${name}.schema.json`, MAX_YAML_BYTES);
  let schema: object;
  try { schema = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as object; }
  catch { throw new InputError(`Invalid ${name} JSON schema.`); }
  try { return createSchemaValidator<T>(schema); }
  catch { throw new InputError(`Cannot compile ${name} JSON schema in strict mode.`); }
}

export function schemaIssues(validate: ValidateFunction, data: unknown): string[] {
  if (validate(data)) return [];
  // Do not echo YAML values or unknown field names into generic diagnostics.
  return [...new Set((validate.errors ?? []).map((error) => {
    const pointer = error.instancePath || "/";
    return `${pointer}: ${error.message ?? "schema validation failed"}.`;
  }))].slice(0, 12);
}
