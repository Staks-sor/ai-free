import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";

import { compareVersions, windowsNodeInstallRoots } from "../src/updater.mjs";

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

describe("windows Node.js discovery", () => {
  it("includes the running node directory and standard MSI locations", () => {
    const roots = windowsNodeInstallRoots({
      execPath: path.join(path.sep, "Portable", "node.exe"),
      env: {
        ProgramW6432: "C:\\Program Files",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\User\\AppData\\Local",
      },
    });
    assert.ok(roots.includes(path.join(path.sep, "Portable")));
    assert.ok(roots.includes(path.join("C:\\Program Files", "nodejs")));
  });
});
