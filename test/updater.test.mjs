import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { compareVersions } from "../src/updater.mjs";

describe("compareVersions", () => {
  it("orders semantic versions", () => {
    assert.equal(compareVersions("0.2.12", "0.2.13"), -1);
    assert.equal(compareVersions("0.3.0", "0.2.99"), 1);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  });

  it("accepts v-prefixed versions", () => {
    assert.equal(compareVersions("v1.2.0", "1.2.1"), -1);
    assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
  });
});
