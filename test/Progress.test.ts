import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("progress", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("sends a saved player their progress and saves what they send back", async () => {
    const fake = fakePlayers([{ _id: "u1", cash: 5000, weightsOwned: ["dumbbell", "sphere"], weightEquipped: "sphere", best: 90, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "u1", username: "Ann" });
    let got: any = null;
    c.onMessage("progress", (m: any) => (got = m));
    c.onMessage("daily", () => {});
    fake.release();
    await sleep(150);
    assert.strictEqual(got?.cash, 5000);
    assert.deepStrictEqual(got?.weightsOwned, ["dumbbell", "sphere"]);
    assert.strictEqual(got?.weightEquipped, "sphere");

    c.send("saveProgress", { cash: 7000, strength: 80, best: 40, eggs: [0, 1, 1], pets: [{ id: "parrot", on: true }], rebirths: 2, goalPlayed: 90.5, goalHatched: 3, goalDone: ["pass"], hack: 1 });
    await sleep(150);
    const doc = fake.docs.get("u1")! as any;
    assert.strictEqual(doc.cash, 7000);
    assert.strictEqual(doc.goalPlayed, 90.5);
    assert.strictEqual(doc.goalHatched, 3);
    assert.deepStrictEqual(doc.goalDone, ["pass"]);
    assert.deepStrictEqual(doc.eggs, [0, 1, 1]);
    assert.deepStrictEqual(doc.pets, [{ id: "parrot", on: true }]);
    assert.strictEqual(doc.rebirths, 2);
    assert.strictEqual(doc.best, 90, "the best climb never goes down");
    assert.strictEqual(doc.weightEquipped, "sphere", "sections not sent are left alone");
    assert.strictEqual(doc.username, "Ann");
    assert.ok(!("hack" in doc));
  });

  it("creates a new account's save and never saves a guest", async () => {
    const fake = fakePlayers();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "new1" });
    let none = false;
    c.onMessage("noProgress", () => (none = true));
    c.onMessage("daily", () => {});
    fake.release();
    await sleep(150);
    assert.ok(none);
    c.send("saveProgress", { cash: 10 });
    await sleep(150);
    assert.strictEqual(fake.docs.get("new1")?.cash, 10);

    const guest = await colyseus.connectTo(room, { userId: "guest-abc" });
    guest.onMessage("noProgress", () => {});
    guest.onMessage("daily", () => {});
    await sleep(150);
    guest.send("saveProgress", { cash: 99 });
    await sleep(150);
    assert.strictEqual(fake.docs.size, 1, "a guest is never written");
    assert.strictEqual(room.state.players.get(guest.sessionId)?.signedIn, false);
  });

  it("loads the new identity when a guest signs in mid-session", async () => {
    const fake = fakePlayers([{ _id: "u2", cash: 42, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "guest-x" });
    let got: any = null;
    c.onMessage("noProgress", () => {});
    c.onMessage("progress", (m: any) => (got = m));
    c.onMessage("daily", () => {});
    fake.release();
    await sleep(150);
    c.send("identify", { userId: "u2", username: "Bea" });
    await sleep(150);
    assert.strictEqual(got?.cash, 42);
    assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, true);
  });

  it("keeps saving off when the save could not be read", async () => {
    const fake = fakePlayers([{ _id: "u3", cash: 1e9, version: 1, updatedAt: new Date() }]);
    (fake as any).findOne = async () => {
      await fake.gate;
      throw new Error("down");
    };
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "u3" });
    let failed = false;
    c.onMessage("serverError", () => (failed = true));
    fake.release();
    await sleep(150);
    assert.ok(failed);
    c.send("saveProgress", { cash: 0 });
    await sleep(150);
    assert.strictEqual(fake.docs.get("u3")!.cash, 1e9, "the unread save is never overwritten");
  });

  it("refuses a rewarded-ad grant that Bloxity did not verify", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "ad1" });
    c.onMessage("noProgress", () => {});
    c.onMessage("daily", () => {});
    const results: any[] = [];
    c.onMessage("adResult", (m: any) => results.push(m));
    await sleep(100);
    c.send("adReward", { placement: "free-cash", rewardToken: "forged" });
    c.send("adReward", { placement: "nope", rewardToken: "x" });
    await sleep(150);
    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.ok === false));
  });
});
