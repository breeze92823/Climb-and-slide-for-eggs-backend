import assert from "assert";

import { BEST_MAX, CURRENCY_MAX } from "../src/constants.js";
import { sanitizeProgress } from "../src/sanitize.js";

describe("sanitizeProgress", () => {
  it("rejects non-objects and bounds numbers", () => {
    assert.strictEqual(sanitizeProgress(null), null);
    assert.strictEqual(sanitizeProgress([1]), null);
    const out = sanitizeProgress({ cash: 1e40, strength: -5, best: 1e12, rebirths: 3.7, auto: "yes", paws: NaN, hack: "x" })!;
    assert.strictEqual(out.cash, CURRENCY_MAX);
    assert.strictEqual(out.strength, 0);
    assert.strictEqual(out.best, BEST_MAX);
    assert.strictEqual(out.rebirths, 3);
    assert.strictEqual(out.auto, undefined);
    assert.strictEqual(out.paws, undefined);
    assert.ok(!("hack" in out));
  });

  it("returns only the fields that were sent", () => {
    assert.deepStrictEqual(sanitizeProgress({ cash: 5 }), { cash: 5 });
  });

  it("keeps well-formed hotbar eggs, placed eggs and pets", () => {
    const out = sanitizeProgress({
      eggs: [0, 2, 2, -1, 1.5, "x", 999],
      placed: [{ tier: 1, x: 3, z: -4 }, { tier: 1.5, x: 0, z: 0 }, { tier: 0, x: NaN, z: 0 }, "x"],
      pets: [{ id: "parrot", on: true }, { id: "Bad Id!", on: true }, { id: "bat" }, 7],
      baseLevel: 2.9,
    })!;
    assert.deepStrictEqual(out.eggs, [0, 2, 2]);
    assert.deepStrictEqual(out.placed, [{ tier: 1, x: 3, z: -4 }]);
    assert.deepStrictEqual(out.pets, [{ id: "parrot", on: true }, { id: "bat", on: false }]);
    assert.strictEqual(out.baseLevel, 2);
  });

  it("only equips an owned weight and keeps Index keys well-formed", () => {
    const out = sanitizeProgress({
      weightsOwned: ["dumbbell", "dumbbell", "Bad Id!"],
      weightEquipped: "sphere",
      indexEggs: ["basic", "bad id"],
      indexFound: ["normal:parrot", "normal", "gold:bat:x"],
    })!;
    assert.deepStrictEqual(out.weightsOwned, ["dumbbell"]);
    assert.strictEqual(out.weightEquipped, undefined);
    assert.deepStrictEqual(out.indexEggs, ["basic"]);
    assert.deepStrictEqual(out.indexFound, ["normal:parrot"]);
  });
});
