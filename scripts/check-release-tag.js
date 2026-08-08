#!/usr/bin/env node
import fs from "node:fs";

const tag = process.argv[2];
if (!tag?.startsWith("v")) {
  console.error(`Release tag must start with v; received ${JSON.stringify(tag)}`);
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expected = `v${metadata.version}`;
if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package version ${metadata.version}`);
  process.exit(1);
}

console.log(`${tag} matches package.json`);
