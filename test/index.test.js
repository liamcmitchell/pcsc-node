import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Package Exports", () => {
  const packageJsonPath = resolve(__dirname, "../package.json");

  it("should have exports field with main and native entries", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    assert(packageJson.exports, "exports field should exist");
    assert.strictEqual(
      packageJson.exports["."],
      "./lib/index.js",
      'exports["."] should point to lib/index.js',
    );
    assert.strictEqual(
      packageJson.exports["./native"],
      "./lib/native.js",
      'exports["./native"] should point to lib/native.js',
    );
  });

  it("should have type: module for ESM", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    assert.strictEqual(packageJson.type, "module", 'type should be "module" for ESM');
  });
});
