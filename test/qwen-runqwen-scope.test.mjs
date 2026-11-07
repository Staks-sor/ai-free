import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

// Инцидент 03.10 18:14 (TG, живой тест): «Субагент упал с ошибкой
// accountAttempt is not defined». Ночной патч «видимости не-стрим пути»
// врезал логирование с accountAttempt в runQwen, но переменная объявлена
// в цикле ротации НИЖЕ — вне скоупа замыкания. Каждый не-стрим запрос
// (все субагенты Hermes шлют stream:false) падал с ReferenceError до
// createChat. Инвариант: если тело runQwen ссылается на accountAttempt,
// он обязан быть объявлен в сигнатуре (параметр), а не остаться свободной
// переменной из внешнего цикла.

const file = path.resolve("api/openai-handler.mjs");
const src = fs.readFileSync(file, "utf8");

function extractArrowFunc(name) {
  const start = src.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `${name} не найден`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail(`не нашли конец ${name}`);
}

describe("runQwen scope invariants", () => {
  const fn = extractArrowFunc("runQwen");
  const arrowAt = fn.indexOf("=>");
  const signature = fn.slice(0, arrowAt);
  const body = fn.slice(arrowAt + 2);

  it("accountAttempt: если используется в теле — объявлен в сигнатуре", () => {
    const usedInBody = /\baccountAttempt\b/.test(body);
    const declaredInSignature = /\baccountAttempt\b/.test(signature);
    assert.ok(
      !usedInBody || declaredInSignature,
      "runQwen использует accountAttempt как свободную переменную — ReferenceError на каждом не-стрим запросе (субагенты, инцидент 18:14)",
    );
  });

  it("triedAccountIds не упоминается вообще (объявлен в цикле ниже)", () => {
    assert.ok(
      !/\btriedAccountIds\b/.test(fn),
      "runQwen ссылается на triedAccountIds вне скоупа",
    );
  });
});
