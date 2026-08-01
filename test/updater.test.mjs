import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";

import {
  compareVersions,
  windowsNodeInstallRoots,
  windowsNpmCommandCandidates,
} from "../src/updater.mjs";

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

  it("finds npm from npm start, standard installs and common Windows version managers", () => {
    const env = {
      APPDATA: "C:\\Users\\User\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\User\\AppData\\Local",
      USERPROFILE: "C:\\Users\\User",
      ProgramFiles: "C:\\Program Files",
      NVM_SYMLINK: "C:\\Program Files\\nodejs",
      npm_node_execpath: "D:\\Node\\node.exe",
      npm_execpath: "D:\\Node\\node_modules\\npm\\bin\\npm-cli.js",
    };
    const candidates = windowsNpmCommandCandidates({ env, execPath: env.npm_node_execpath });
    const commands = candidates.map((candidate) => typeof candidate === "string" ? candidate : candidate.command);
    const direct = candidates.find((candidate) => typeof candidate === "object"
      && candidate.command === env.npm_node_execpath
      && candidate.prefixArgs?.[0] === env.npm_execpath);

    assert.ok(direct, "npm start should preserve a direct node + npm-cli fallback");
    assert.ok(commands.includes(path.join(env.ProgramFiles, "nodejs", "npm.cmd")));
    assert.ok(commands.includes(path.join(env.NVM_SYMLINK, "npm.cmd")));
    assert.ok(commands.includes(path.join(env.LOCALAPPDATA, "Volta", "bin", "npm.cmd")));
    assert.ok(commands.includes(path.join(env.USERPROFILE, "scoop", "apps", "nodejs", "current", "npm.cmd")));
  });
});
