import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { AVATAR_MAX_LEN, POSE_COORD_MAX, POSE_SPEED_MAX } from "../src/constants.js";
import { sanitizeAvatar, sanitizePose } from "../src/presence.js";
import { sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("presence rules", () => {
  it("bounds a pose and rejects anything that is not one", () => {
    assert.deepStrictEqual(sanitizePose({ x: 1, y: 2, z: 3, yaw: 1, speed: 4 }), { x: 1, y: 2, z: 3, yaw: 1, speed: 4 });
    const p = sanitizePose({ x: 1e12, y: -1e12, z: 0, yaw: 7 * Math.PI, speed: 1e9 })!;
    assert.strictEqual(p.x, POSE_COORD_MAX);
    assert.strictEqual(p.y, -POSE_COORD_MAX);
    assert.strictEqual(p.speed, POSE_SPEED_MAX);
    assert.ok(Math.abs(p.yaw) <= Math.PI + 1e-9);
    assert.strictEqual(sanitizePose({ x: 1, y: 2, z: 3, yaw: 1 }), null, "missing field");
    assert.strictEqual(sanitizePose({ x: NaN, y: 2, z: 3, yaw: 1, speed: 0 }), null);
    assert.strictEqual(sanitizePose({ x: "1", y: 2, z: 3, yaw: 1, speed: 0 }), null);
    assert.strictEqual(sanitizePose(null), null);
    assert.strictEqual(sanitizePose("x"), null);
    assert.strictEqual(sanitizePose({ x: 1, y: 2, z: 3, yaw: 1, speed: -5 })!.speed, 0);
  });

  it("keeps an avatar look only as a short string, without parsing it", () => {
    assert.strictEqual(sanitizeAvatar({ look: "{not json" }), "{not json");
    assert.strictEqual(sanitizeAvatar({ look: "x".repeat(AVATAR_MAX_LEN + 1) }), null);
    assert.strictEqual(sanitizeAvatar({ look: { a: 1 } }), null);
    assert.strictEqual(sanitizeAvatar(null), null);
  });
});

describe("presence room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("shows each player's pose and avatar to the others, bounded and rate-limited", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { username: "Ann", userId: "acc-1" });
    const b = await colyseus.connectTo(room, { username: "Bo" });
    await sleep(50);

    a.send("pose", { x: 3, y: 1, z: -4, yaw: 0.5, speed: 6 });
    a.send("pose", { x: 99, y: 0, z: 0, yaw: 0, speed: 0 }); // straight after: dropped by the rate limit
    a.send("setAvatar", { look: '{"hatId":"1"}' });
    await sleep(100);
    const seen = b.state.players.get(a.sessionId)!;
    assert.strictEqual(seen.username, "Ann");
    assert.strictEqual(seen.uid, "acc-1");
    assert.ok(seen.posed);
    assert.ok(Math.abs(seen.x - 3) < 1e-4 && Math.abs(seen.z + 4) < 1e-4 && Math.abs(seen.speed - 6) < 1e-4);
    assert.strictEqual(seen.avatar, '{"hatId":"1"}');
    assert.ok(!b.state.players.get(b.sessionId)!.posed, "no pose sent yet");

    await sleep(100);
    a.send("pose", { x: 1e12, y: 0, z: 0, yaw: 0, speed: 0 });
    a.send("setAvatar", { look: "x".repeat(AVATAR_MAX_LEN + 1) });
    await sleep(100);
    const p = room.state.players.get(a.sessionId)!;
    assert.strictEqual(p.x, POSE_COORD_MAX);
    assert.strictEqual(p.avatar, '{"hatId":"1"}', "an oversized look is ignored");
  });
});
