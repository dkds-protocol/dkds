/**
 * The version of the package, read from its `package.json`.
 */

import { readFileSync } from "node:fs";

/** The version of the package. */
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
