#!/usr/bin/env node
// The dynamic boundary installs the warning filter before Node loads SQLite.
import "./runtime-warnings.js";
await import("./cli-main.js");
