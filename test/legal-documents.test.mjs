import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  LEGAL_DOCS,
  hasCompleteLegalOperator,
  resolveLegalBundle,
} from "../packages/core/src/legal/ru.mjs";

describe("Russian legal document bundle", () => {
  it("contains the complete product document set", () => {
    assert.deepEqual(
      LEGAL_DOCS.map((doc) => doc.id),
      ["alpha", "offer", "privacy", "consent", "refunds", "deletion"],
    );
  });

  it("does not use an unconditional no-refunds clause", () => {
    const refunds = LEGAL_DOCS.find((doc) => doc.id === "refunds");
    const text = refunds.sections.flat().join(" ");
    assert.match(text, /фактически понесённые расходы/i);
    assert.match(text, /обязательного возврата/i);
    assert.doesNotMatch(text, /возврат(?:ы|а)? не производится ни при каких/i);
  });

  it("requires real operator details before commercial launch", () => {
    assert.equal(hasCompleteLegalOperator(), false);
    const bundle = resolveLegalBundle({
      name: "ИП Иванов Иван Иванович",
      status: "ИП",
      inn: "123456789012",
      ogrn: "123456789012345",
      address: "г. Москва",
      email: "privacy@example.ru",
    });
    assert.equal(bundle.operatorComplete, true);
    assert.match(JSON.stringify(bundle.docs), /privacy@example\.ru/);
  });
});
