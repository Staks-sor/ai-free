import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  getDuplicateInventory,
  formatInventoryReport,
  assertInventoryInvariants,
  KNOWN_PLATFORM_SPECIFIC,
  KNOWN_DESKTOP_ONLY,
} from "../scripts/inventory-duplicates.mjs";

describe("duplicate module inventory", () => {
  it("synchronizes all duplicate files with zero unexpected divergences", () => {
    const inventory = assertInventoryInvariants();
    assert.equal(inventory.divergent.length, 0, "No divergent modules should exist");
    assert.ok(inventory.summary.identicalCount >= 150, "Should track at least 150 identical files");
    assert.equal(inventory.summary.platformSpecificCount, KNOWN_PLATFORM_SPECIFIC.size);
    assert.equal(inventory.summary.desktopOnlyCount, KNOWN_DESKTOP_ONLY.size);
  });

  it("documents known intentional platform-specific differences", () => {
    const inventory = getDuplicateInventory();
    const platformPaths = inventory.platformSpecific.map((item) => item.desktopPath);
    assert.ok(platformPaths.includes("src/state/window-state.mjs"));
    assert.ok(platformPaths.includes("src/window-app/web-browser.mjs"));
    for (const item of inventory.platformSpecific) {
      assert.ok(item.reason && item.reason.length > 10, "Platform difference must have documented reason");
    }
  });

  it("formats a comprehensive markdown report with migration candidates", () => {
    const report = formatInventoryReport();
    assert.match(report, /Отчёт инвентаризации дублирования модулей/);
    assert.match(report, /Полностью идентичные модули/);
    assert.match(report, /Каталог моделей и абстракции провайдеров/);
    assert.match(report, /Локализация и языковые ресурсы/);
    assert.match(report, /Алгоритмы памяти и поиска/);
    assert.match(report, /Парсеры и утилиты кодового агента/);
    assert.match(report, /Сервис распознавания речи/);
  });
});
