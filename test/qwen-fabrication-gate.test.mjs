import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): всё в tmp, реальный accounts.json не трогаем.
process.env.QWEN_ACCOUNTS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qwen-gate-")), "accounts.json");

const { makeToolFabricationGate } = await import("../api/openai-handler.mjs");

describe("makeToolFabricationGate", () => {
  it("пропускает нормальный текст после лимита буфера", () => {
    const gate = makeToolFabricationGate();
    let out = "";
    for (const piece of ["Сейчас проверю файл. ", "Читаю данные и делаю расчёт. ", "Ещё немного текста."]) {
      out += gate.push(piece) ?? "";
    }
    // всё, что не фабрикация, в конце отдаётся целиком (flush)
    const flushed = gate.flush();
    assert.ok((out + flushed).includes("Читаю данные"));
    assert.equal(gate.fabricated(), false);
  });

  it("ловит фабрикацию «инструменты недоступны» в начале ответа и блокирует всё", () => {
    const gate = makeToolFabricationGate();
    const r1 = gate.push("К сожалению, все инструменты в текущей сессии недоступны");
    assert.equal(r1, ""); // ничего не прошло клиенту
    assert.equal(gate.fabricated(), true);
    const r2 = gate.push(" и поэтому я не могу прочитать файл.");
    assert.equal(r2, ""); // и после детекта тоже
    assert.equal(gate.flush(), "");
  });

  it("ловит английскую фабрикацию tools are broken", () => {
    const gate = makeToolFabricationGate();
    gate.push("I cannot use the tools right now — tools are broken.");
    assert.equal(gate.fabricated(), true);
  });

  it("ловит «не могу вызвать инструменты»", () => {
    const gate = makeToolFabricationGate();
    gate.push("Я не могу вызвать инструменты для чтения файла, поэтому отвечу по памяти.");
    assert.equal(gate.fabricated(), true);
  });

  it("НЕ считает фабрикацией текст после лимита буфера", () => {
    const gate = makeToolFabricationGate();
    // 700 символов нормальной прозы, упоминание «инструмент… недоступен» глубоко в хвосте
    const long = "Анализирую задачу. ".repeat(40) + " Отдельный инструмент был недоступен вчера, но сегодня всё работает.";
    gate.push(long);
    // Слова за пределами окна детекции не считаются фабрикацией начала ответа
    assert.equal(gate.fabricated(), false);
  });

  it("ловит RU daily limit «Вы достигли дневного лимита»", () => {
    const gate = makeToolFabricationGate();
    gate.push("Вы достигли дневного лимита для Qwen3.8-Max. Обновите подписку.");
    assert.equal(gate.fabricated(), true);
    assert.equal(gate.flush(), "");
  });

  it("ловит EN daily limit «reached the daily limit»", () => {
    const gate = makeToolFabricationGate();
    gate.push("You have reached the daily limit for free tier requests.");
    assert.equal(gate.fabricated(), true);
  });

  it("ловит CN daily limit «您已达到每日限制»", () => {
    const gate = makeToolFabricationGate();
    gate.push("您已达到每日限制，请升级订阅或稍后再试。");
    assert.equal(gate.fabricated(), true);
  });
});
