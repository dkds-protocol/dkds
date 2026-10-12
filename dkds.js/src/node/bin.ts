#!/usr/bin/env node
/**
 * Entry point of the `dkds` command.
 */

import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2));
