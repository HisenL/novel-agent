import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { schemaCatalog } from "../src/schemas.js";
import { stableJson } from "../src/stable-json.js";

const schemaDirectory = fileURLToPath(new URL("../schemas/", import.meta.url));
const expectedFiles = Object.keys(schemaCatalog)
  .map((name) => `${name}.schema.json`)
  .sort();
const actualFiles = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

const errors: string[] = [];
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  errors.push(
    `Schema file set differs. Expected ${expectedFiles.join(", ")}; found ${actualFiles.join(", ")}.`,
  );
}

for (const [name, schema] of Object.entries(schemaCatalog)) {
  const path = `${schemaDirectory}/${name}.schema.json`;
  let actual: string;
  try {
    actual = await readFile(path, "utf8");
  } catch {
    errors.push(`Missing generated schema: ${name}.schema.json.`);
    continue;
  }
  if (actual !== stableJson(schema)) {
    errors.push(`${name}.schema.json is stale; run pnpm schemas:generate.`);
  }
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}
