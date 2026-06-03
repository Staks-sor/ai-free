// Proof-of-Work для DeepSeek API. Сервер выдаёт challenge с алгоритмом DeepSeekHashV1,
// клиент решает через WASM-бинарь (тот же, что в их фронте) и возвращает ответ в base64.
// Это анти-бот защита; нет PoW — нет completion.

import { DEEPSEEK_SHA3_WASM } from "../config.mjs";

// Module-level singleton: WASM грузится один раз за жизнь процесса.
let wasmSolverPromise = null;

export async function solvePow(challenge) {
  if (challenge.algorithm !== "DeepSeekHashV1") {
    throw new Error(`Unsupported PoW algorithm: ${challenge.algorithm}`);
  }

  const expireAt = challenge.expire_at ?? challenge.expireAt;
  if (typeof expireAt !== "number") {
    throw new Error("PoW challenge is missing expire_at.");
  }

  const solver = await getWasmSolver();
  const answer = solver.calculateHash(
    challenge.algorithm,
    challenge.challenge,
    challenge.salt,
    Number(challenge.difficulty),
    expireAt,
  );

  if (!Number.isInteger(answer)) {
    throw new Error("PoW solver did not return a valid integer answer.");
  }

  return answer;
}

export async function getWasmSolver() {
  wasmSolverPromise ??= DeepSeekHash.create(DEEPSEEK_SHA3_WASM);
  return wasmSolverPromise;
}

// Обёртка вокруг WASM-экспорта. Точно повторяет логику фронта DeepSeek —
// если они поменяют WASM, мы автоматически подтянем новый по URL,
// но если изменится сигнатура wasm_solve — починка нужна здесь.
export class DeepSeekHash {
  constructor(wasmInstance) {
    this.wasmInstance = wasmInstance;
    this.offset = 0;
    this.cachedUint8Memory = null;
    this.cachedTextEncoder = new TextEncoder();
  }

  static async create(wasmUrl) {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`Failed to load PoW WASM: HTTP ${res.status}`);
    const wasmBuffer = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBuffer, { wbg: {} });
    return new DeepSeekHash(instance.exports);
  }

  getCachedUint8Memory() {
    if (this.cachedUint8Memory === null || this.cachedUint8Memory.byteLength === 0) {
      this.cachedUint8Memory = new Uint8Array(this.wasmInstance.memory.buffer);
    }
    return this.cachedUint8Memory;
  }

  encodeString(text, allocate, reallocate) {
    if (!reallocate) {
      const encoded = this.cachedTextEncoder.encode(text);
      const ptr = allocate(encoded.length, 1) >>> 0;
      this.getCachedUint8Memory().subarray(ptr, ptr + encoded.length).set(encoded);
      this.offset = encoded.length;
      return ptr;
    }

    const strLength = text.length;
    let ptr = allocate(strLength, 1) >>> 0;
    const memory = this.getCachedUint8Memory();
    let asciiLength = 0;

    for (; asciiLength < strLength; asciiLength += 1) {
      const charCode = text.charCodeAt(asciiLength);
      if (charCode > 127) break;
      memory[ptr + asciiLength] = charCode;
    }

    if (asciiLength !== strLength) {
      if (asciiLength > 0) text = text.slice(asciiLength);
      ptr = reallocate(ptr, strLength, asciiLength + text.length * 3, 1) >>> 0;
      const result = this.cachedTextEncoder.encodeInto(
        text,
        this.getCachedUint8Memory().subarray(
          ptr + asciiLength,
          ptr + asciiLength + text.length * 3,
        ),
      );
      asciiLength += result.written;
      ptr = reallocate(ptr, asciiLength + text.length * 3, asciiLength, 1) >>> 0;
    }

    this.offset = asciiLength;
    return ptr;
  }

  calculateHash(algorithm, challenge, salt, difficulty, expireAt) {
    if (algorithm !== "DeepSeekHashV1") {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }

    const prefix = `${salt}_${expireAt}_`;
    const retptr = this.wasmInstance.__wbindgen_add_to_stack_pointer(-16);

    try {
      const ptr0 = this.encodeString(
        challenge,
        this.wasmInstance.__wbindgen_export_0,
        this.wasmInstance.__wbindgen_export_1,
      );
      const len0 = this.offset;
      const ptr1 = this.encodeString(
        prefix,
        this.wasmInstance.__wbindgen_export_0,
        this.wasmInstance.__wbindgen_export_1,
      );
      const len1 = this.offset;

      this.wasmInstance.wasm_solve(retptr, ptr0, len0, ptr1, len1, difficulty);
      const dataView = new DataView(this.wasmInstance.memory.buffer);
      const status = dataView.getInt32(retptr, true);
      const value = dataView.getFloat64(retptr + 8, true);
      return status === 0 ? undefined : value;
    } finally {
      this.wasmInstance.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
