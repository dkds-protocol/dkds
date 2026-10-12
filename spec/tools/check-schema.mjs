// Validates ../vectors/vectors.json against ../vectors/vectors.schema.json.
//
//   node check-schema.mjs

import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const schema = read("../vectors/vectors.schema.json");
const data = read("../vectors/vectors.json");
// strictRequired is off: it rejects `required` inside if/then branches, which
// JSON Schema allows.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
if (!ajv.validate(schema, data)) {
  console.log(JSON.stringify(ajv.errors, null, 2));
  process.exit(1);
}
console.log("vectors.json conforms to vectors.schema.json");
