import { Room, Client, CloseCode } from "colyseus";
import { WorldState, PlayerState } from "./schema/WorldState.js";
import { AD_PLACEMENTS, GUEST_ID_PREFIX, POSE_MIN_INTERVAL_MS, NAME_MAX, PFP_MAX_LEN, RECONNECT_SECONDS, ROOM_MAX_CLIENTS, STATS_EVERY_MS } from "../constants.js";
import { getPlayers, type PlayerDoc } from "../db.js";
import { sanitizeProgress } from "../sanitize.js";
import { sanitizeAvatar, sanitizeBase, sanitizePose } from "../presence.js";
import { claimDaily, dailyFields, dailyView, readDaily, rollDaily, type DailyState } from "../daily.js";
import { reportStats, statValues, verificationRequired, verifyGameToken, verifyRewardToken } from "../bloxity.js";

function sanitizeName(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, NAME_MAX) : "";
}

function sanitizePfp(raw: unknown): string {
  return typeof raw === "string" && raw.length <= PFP_MAX_LEN && /^https?:\/\//i.test(raw) ? raw : "";
}

interface JoinOptions {
  username?: string;
  userId?: string;
  pfp?: string;
  token?: string; // Legion.SDK.auth.getToken(): verified when deployed (bloxity.ts)
  partyKey?: string; // Legion.SDK.party launch roomKey: a party is seated in one room
}

/**
 * Room every client joins via `client.joinOrCreate("world", { token, userId, username })`.
 * Loads and saves each signed-in player's progress (MongoDB, see db.ts) -- the client keeps a
 * localStorage copy only for guests and offline play. The game is client-authoritative: no
 * gameplay rules live here, saves are only bounded (sanitize.ts); the Daily Reward calendar and
 * rewarded-ad grants are the server's. Full rooms spill into a fresh one automatically (maxClients).
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  state = new WorldState();
  maxClients = ROOM_MAX_CLIENTS;

  // sessionId -> user id (Bloxity id). Deliberately NOT part of WorldState: it only gates this
  // room's own Mongo reads/writes. Guests have no entry.
  userIds = new Map<string, string>();

  // sessionIds that already got a progress/noProgress answer for their current identity.
  private identified = new Set<string>();
  // sessionIds whose current identity's save has been read: only these may write. A save sent
  // before the load answered would overwrite the stored progress with a fresh player's defaults.
  private loaded = new Set<string>();
  // sessionId -> Daily Reward state (daily.ts), read with the save. Guests and serverless sessions
  // keep theirs here only (like the rest of their progress, it lasts the session).
  private dailies = new Map<string, DailyState>();
  // user id -> stats waiting for the next report to Bloxity (bloxity.ts).
  private statsDirty = new Map<string, Record<string, number>>();
  // Bumped per identity change, so an in-flight token check can tell it was superseded.
  private authSeq = new Map<string, number>();

  // sessionId -> time of the last accepted pose (rate limit).
  private lastPose = new Map<string, number>();

  messages = {
    // The player's position, ~10/s. Bounded and rate-limited; relayed to everyone through state.
    pose: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const pose = sanitizePose(msg);
      const now = Date.now();
      if (!p || !pose || now - (this.lastPose.get(client.sessionId) ?? 0) < POSE_MIN_INTERVAL_MS) return;
      this.lastPose.set(client.sessionId, now);
      Object.assign(p, pose);
      p.posed = true;
    },
    // The Bloxity avatar look (JSON text from the SDK), sent when it changes. Never parsed here.
    setAvatar: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const look = sanitizeAvatar(msg);
      if (p && look !== null) p.avatar = look;
    },
    // The player's plot (active pets, equipped weight, rate), so the other seats can draw it.
    setBase: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const base = sanitizeBase(msg);
      if (p && base !== null) p.base = base;
    },
    // Debounced push of the client's progress (only the sections that changed). Upserts, so a
    // first save creates the document.
    saveProgress: async (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const patch = sanitizeProgress(msg);
      if (!p || !patch || !this.loaded.has(client.sessionId)) return;

      const userId = this.userIds.get(client.sessionId);
      if (!userId) return;
      const players = getPlayers();
      if (!players) return; // Mongo unset/unreachable -- degrade silently
      // The personal best only ever goes up ($max), so a stale or replayed save can't lower it.
      const { best, ...rest } = patch;
      try {
        await players.updateOne(
          { _id: userId },
          {
            // Display name comes from this connection's own PlayerState, not `msg`.
            $set: { ...rest, username: p.username || "Player", updatedAt: new Date() },
            ...(best !== undefined && { $max: { best } }),
            $setOnInsert: { version: 1 },
          },
          { upsert: true },
        );
        this.statsDirty.set(userId, { ...this.statsDirty.get(userId), ...statValues(patch) });
      } catch (err) {
        console.warn("[WorldRoom] saveProgress failed", err);
      }
    },
    // Claims Daily Reward day `msg.day` (0-based). The server decides: answers `dailyResult`
    // { ok, day, ...state }; the client only grants the reward on ok.
    claimDaily: async (client: Client, msg: { day?: unknown }) => {
      const s = this.dailies.get(client.sessionId);
      const day = msg?.day;
      if (!s || !this.loaded.has(client.sessionId)) return client.send("dailyResult", { ok: false, day, reason: "loading" });
      if (rollDaily(s)) void this.saveDaily(client.sessionId, s); // midnight passed while online
      if (!claimDaily(s, day)) return client.send("dailyResult", { ok: false, day, reason: "locked", ...dailyView(s) });
      if (!(await this.saveDaily(client.sessionId, s))) {
        s.claimed = s.claimed.filter((i) => i !== day); // not stored: not claimed
        return client.send("dailyResult", { ok: false, day, reason: "save", ...dailyView(s) });
      }
      client.send("dailyResult", { ok: true, day, ...dailyView(s) });
    },
    // The client's countdown reached the next UTC day: unlock it (server clock) and answer `daily`.
    dailyRefresh: (client: Client) => {
      const s = this.dailies.get(client.sessionId);
      if (!s || !this.loaded.has(client.sessionId)) return;
      if (rollDaily(s)) void this.saveDaily(client.sessionId, s);
      client.send("daily", dailyView(s));
    },
    // A finished rewarded ad (Legion.SDK.ads.showRewarded): the token is checked with Bloxity
    // (single-use, this game, this placement) and only then does the client grant the reward.
    // Answers `adResult` { ok, placement, reason? }.
    adReward: async (client: Client, msg: { rewardToken?: unknown; placement?: unknown }) => {
      const placement = typeof msg?.placement === "string" ? msg.placement : "";
      const refuse = (reason: string) => client.send("adResult", { ok: false, placement, reason });
      if (!(AD_PLACEMENTS as readonly string[]).includes(placement)) return refuse("placement");
      const v = await verifyRewardToken(msg?.rewardToken);
      if (!v.valid) return refuse(v.reason ?? "invalid");
      const userId = this.userIds.get(client.sessionId);
      if (v.placement !== placement || (v.userId && userId && v.userId !== userId)) return refuse("mismatch");
      client.send("adResult", { ok: true, placement });
    },
    // Re-states identity after a login/logout that happens AFTER join (a guest who signs in
    // mid-session). The server answers with progress/noProgress for the new identity.
    identify: (client: Client, msg: JoinOptions) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      void this.authenticate(client, p, msg);
    },
  };

  onCreate() {
    this.clock.setInterval(() => this.flushStats(), STATS_EVERY_MS);
  }

  onDispose() {
    this.flushStats();
  }

  // Stats for the game page (bloxity.ts): what this room's players saved since the last report.
  private flushStats() {
    if (!this.statsDirty.size) return;
    const batch = this.statsDirty;
    this.statsDirty = new Map();
    void reportStats(batch);
  }

  onJoin(client: Client, options?: JoinOptions) {
    const p = new PlayerState();
    p.seat = this.freeSeat();
    this.state.players.set(client.sessionId, p);
    void this.authenticate(client, p, options);
  }

  // The lowest base seat nobody holds (a leaver's seat frees when forgetSession drops them).
  private freeSeat(): number {
    const taken = new Set<number>();
    this.state.players.forEach((q) => taken.add(q.seat));
    for (let i = 0; i < ROOM_MAX_CLIENTS; i++) if (!taken.has(i)) return i;
    return -1;
  }

  // A deliberate `room.leave()` closes with CONSENTED -- drop the player at once. Anything
  // else (WiFi blip, backgrounded tab) gets RECONNECT_SECONDS to reconnect with the same session.
  async onLeave(client: Client, code?: number) {
    if (code === CloseCode.CONSENTED) {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
    }
  }

  // Server-clock "last seen" for a player who has really gone. Call before forgetSession.
  private async stampLastSeen(sessionId: string) {
    const userId = this.userIds.get(sessionId);
    const players = getPlayers();
    if (!userId || !players) return;
    try {
      await players.updateOne({ _id: userId }, { $set: { lastSeen: Date.now() } });
    } catch (err) {
      console.warn("[WorldRoom] stampLastSeen failed", err);
    }
  }

  // Drops a session's per-connection bookkeeping.
  private forgetSession(sessionId: string) {
    this.state.players.delete(sessionId);
    this.userIds.delete(sessionId);
    this.identified.delete(sessionId);
    this.loaded.delete(sessionId);
    this.dailies.delete(sessionId);
    this.authSeq.delete(sessionId);
    this.lastPose.delete(sessionId);
  }

  // Stores a session's Daily Reward state. True when stored, or when there is nowhere to store it
  // (guest / no database: it lives in `dailies` for the session).
  private async saveDaily(sessionId: string, s: DailyState): Promise<boolean> {
    const userId = this.userIds.get(sessionId);
    const players = getPlayers();
    if (!userId || !players) return true;
    try {
      await players.updateOne(
        { _id: userId },
        { $set: { ...dailyFields(s), updatedAt: new Date() }, $setOnInsert: { version: 1 } },
        { upsert: true },
      );
      return true;
    } catch (err) {
      console.warn("[WorldRoom] saveDaily failed", err);
      return false;
    }
  }

  // Works out who the player really is, then loads their save. Deployed (verificationRequired),
  // only a token Bloxity accepts gives an identity -- a bare `userId` is ignored, so nobody can
  // read or overwrite another account's save. Locally the sent `userId` is trusted.
  private async authenticate(client: Client, p: PlayerState, opts?: JoinOptions) {
    const seq = (this.authSeq.get(client.sessionId) ?? 0) + 1;
    this.authSeq.set(client.sessionId, seq);
    this.loaded.delete(client.sessionId); // no writes until the new identity's save is read
    let userId = typeof opts?.userId === "string" ? opts.userId : "";
    let carriedFrom: string[] = [];
    p.username = sanitizeName(opts?.username);
    p.pfp = sanitizePfp(opts?.pfp);

    if (verificationRequired()) {
      const v = await verifyGameToken(opts?.token);
      if (this.authSeq.get(client.sessionId) !== seq || !this.state.players.has(client.sessionId)) return; // superseded or gone
      userId = v?.user._id ?? "";
      carriedFrom = v?.carriedFrom ?? [];
      if (v) {
        p.username = sanitizeName(v.user.displayName || v.user.username) || p.username;
        p.pfp = sanitizePfp(v.user.pfp) || p.pfp;
      }
    }
    this.setUserId(client, p, userId, carriedFrom);
  }

  // Called from authenticate; answers with progress / noProgress / serverError.
  private setUserId(client: Client, p: PlayerState, raw: string, carriedFrom: string[]) {
    let userId = raw.slice(0, 128);
    // Guests (client-made `guest-...` ids) get no identity: nothing is loaded or saved for them.
    if (userId.startsWith(GUEST_ID_PREFIX)) userId = "";
    const prev = this.userIds.get(client.sessionId) || "";
    // No change (e.g. a username-only identify) -- but the very first call must still answer.
    if (userId === prev && this.identified.has(client.sessionId) && this.loaded.has(client.sessionId)) return;
    this.identified.add(client.sessionId);
    p.signedIn = !!userId;
    p.uid = userId;

    if (userId) {
      // Evict any OTHER live session already claiming this account, so one account never has
      // two writers (a crashed tab lingers up to RECONNECT_SECONDS via allowReconnection).
      for (const [sid, uid] of this.userIds) {
        if (sid === client.sessionId || uid !== userId) continue;
        this.forgetSession(sid);
        const stale = this.clients.find((c) => c.sessionId === sid);
        if (stale) {
          try {
            stale.leave(CloseCode.CONSENTED);
          } catch {
            // Already gone -- nothing to clean up.
          }
        }
      }
      this.userIds.set(client.sessionId, userId);
    } else {
      // No identity: stop persisting for this connection. (The client flushes a final
      // saveProgress under the OLD id before sending `identify`.)
      this.userIds.delete(client.sessionId);
    }

    void this.loadProgress(client, userId, p, carriedFrom);
  }

  // Sends the saved doc to just this client so it can hydrate its state ("progress"), or
  // "noProgress" when there is nothing to load (new account, guest, or Mongo unset). A failed read
  // sends "serverError" and keeps saving off, so a save that could not be read is never overwritten.
  private async loadProgress(client: Client, userId: string, p: PlayerState, carriedFrom: string[]) {
    const players = getPlayers();
    let doc: PlayerDoc | null = null;
    if (userId && players) {
      try {
        doc = await players.findOne({ _id: userId });
        if (!doc) doc = await this.carryOver(userId, carriedFrom);
      } catch (err) {
        console.warn("[WorldRoom] loadProgress failed", err);
        client.send("serverError", {});
        return;
      }
    }
    // The player may have left, or switched identity again, while the read was in flight.
    if (this.state.players.get(client.sessionId) !== p || (this.userIds.get(client.sessionId) ?? "") !== userId) return;

    this.loaded.add(client.sessionId);
    const now = Date.now();
    if (!doc) client.send("noProgress", { serverTime: now });
    else client.send("progress", { ...(sanitizeProgress(doc) ?? {}), serverTime: now });

    // Daily Reward: today's day unlocks on join (server clock), then the client gets the calendar.
    const daily = readDaily(doc);
    this.dailies.set(client.sessionId, daily);
    if (rollDaily(daily)) await this.saveDaily(client.sessionId, daily);
    if (this.dailies.get(client.sessionId) === daily) client.send("daily", dailyView(daily));
  }

  // A signed-in player with no save yet inherits the progress of the Bloxity guest this browser
  // played as before (token verify `carriedFrom`), once: the guest's doc is then marked used.
  // Returns the guest's doc to start from (the client saves it under the new id), or null.
  private async carryOver(userId: string, carriedFrom: string[]): Promise<PlayerDoc | null> {
    const players = getPlayers();
    if (!players) return null;
    for (const guestId of carriedFrom) {
      if (guestId === userId) continue;
      const guest = await players.findOne({ _id: guestId });
      if (!guest || guest.carriedTo) continue;
      await players.updateOne({ _id: guestId }, { $set: { carriedTo: userId } });
      const { _id, carriedTo, ...rest } = guest;
      await players.updateOne({ _id: userId }, { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { version: 1 } }, { upsert: true });
      return { ...rest, _id: userId };
    }
    return null;
  }
}
