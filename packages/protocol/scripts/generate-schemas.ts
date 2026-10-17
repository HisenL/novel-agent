import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { schemaCatalog } from "../src/schemas.js";
import { stableJson } from "../src/stable-json.js";

const schemaDirectory = fileURLToPath(new URL("../schemas/", import.meta.url));

await mkdir(schemaDirectory, { recursive: true });
for (const [name, schema] of Object.entries(schemaCatalog).sort(
  ([left], [right]) => left.localeCompare(right),
)) {
  await writeFile(
    `${schemaDirectory}/${name}.schema.json`,
    stableJson(schema),
    "utf8",
  );
}
