/**
 * Node.js-specific parts of dkds: the system resolver and the local HTTP API.
 *
 * @packageDocumentation
 */

export { systemResolver } from "./system.ts";
export { createApiServer } from "./serve.ts";
export type { ApiOptions, ApiSigningKey } from "./serve.ts";
