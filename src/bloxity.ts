// Server side of the Bloxity integrations (https://docs.bloxity.io): player token verification,
// rewarded-ad verification and the per-player stats on the game page. Bloxity hosting injects
// BLOXITY_API_URL, BLOXITY_GAME_ID and BLOXITY_REPORT_TOKEN; locally none is set and everything
// here degrades (ids are trusted, ads are refused, stats are skipped).
import type { PlayerDoc } from "./db.js";

export const GAME_SLUG = "climb-and-slide-for-eggs"; // the client's GAME_SLUG (src/config.js)

const apiUrl = () => (process.env.BLOXITY_API_URL || (process.env.NODE_ENV === "production" ? "https://api.bloxity.io" : "")).replace(/\/$/, "");

// Deployed (or pointed at a Bloxity API): a player's id only counts when its token verifies.
// Local development and the tests trust the id the client sends.
export const verificationRequired = () => !!apiUrl();

export interface VerifiedUser {
  _id: string;
  username?: string;
  displayName?: string;
  pfp?: string;
}
export interface VerifiedToken {
  user: VerifiedUser;
  carriedFrom: string[]; // Bloxity guest ids this browser played as before signing in
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<any | null> {
  const base = apiUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch (err) {
    console.warn(`[bloxity] ${path} failed`, err);
    return null;
  }
}

// POST /v1/auth/game-token/verify: the player the token belongs to, or null.
export async function verifyGameToken(token: unknown): Promise<VerifiedToken | null> {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  const res = await post("/v1/auth/game-token/verify", { gameSlug: GAME_SLUG }, { Authorization: `Bearer ${token}` });
  if (!res?.valid || typeof res.user?._id !== "string" || !res.user._id) return null;
  const carriedFrom = Array.isArray(res.carriedFrom) ? res.carriedFrom.filter((id: unknown): id is string => typeof id === "string").slice(0, 5) : [];
  return { user: res.user, carriedFrom };
}

// POST /v1/ads/reward/verify: `{ valid, userId, placement }`. Each token is single-use.
export async function verifyRewardToken(rewardToken: unknown): Promise<{ valid: boolean; userId: string | null; placement: string; reason?: string }> {
  const none: { valid: boolean; userId: string | null; placement: string } = { valid: false, userId: null, placement: "" };
  if (typeof rewardToken !== "string" || !rewardToken || rewardToken.length > 4096) return { ...none, reason: "missing" };
  const res = await post("/v1/ads/reward/verify", { gameSlug: GAME_SLUG, rewardToken });
  if (!res) return { ...none, reason: "unavailable" };
  return { valid: res.valid === true, userId: typeof res.userId === "string" ? res.userId : null, placement: typeof res.placement === "string" ? res.placement : "", reason: res.reason };
}

// --- Stats ---------------------------------------------------------------------------------
// Shown on the game page. Values are rejected (not clamped) above the type's ceiling.
const CEILING = { number: 1e9, currency: 1e12 } as const;
const STAT_DEFS = [
  { key: "best", label: "Best Climb", type: "number", sortOrder: 1 },
  { key: "rebirths", label: "Rebirths", type: "number", sortOrder: 2 },
  { key: "strength", label: "Strength", type: "number", sortOrder: 3 },
  { key: "cash", label: "Cash", type: "currency", sortOrder: 4 },
] as const;

export function statValues(doc: Partial<PlayerDoc>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of STAT_DEFS) {
    const v = Number((doc as Record<string, unknown>)[d.key]);
    if (Number.isFinite(v) && v >= 0 && v <= CEILING[d.type]) out[d.key] = v;
  }
  return out;
}

const statsReady = () => !!(apiUrl() && process.env.BLOXITY_GAME_ID && process.env.BLOXITY_REPORT_TOKEN);

// Batches of up to 200 players, from the saves this server stored (never raw client packets).
export async function reportStats(entries: Map<string, Record<string, number>>): Promise<void> {
  if (!statsReady() || !entries.size) return;
  const players = [...entries].map(([id, values]) => ({ userId: `legion_${id}`, values }));
  for (let i = 0; i < players.length; i += 200) {
    await post(`/v1/games/${encodeURIComponent(process.env.BLOXITY_GAME_ID!)}/stats`, { definitions: STAT_DEFS, players: players.slice(i, i + 200) }, { Authorization: `Bearer ${process.env.BLOXITY_REPORT_TOKEN}` });
  }
}
