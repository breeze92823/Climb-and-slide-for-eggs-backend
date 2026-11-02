// Keep in step with the client's src/config.js by hand.
// 2-100 (Bloxity party play); the deploy workflow reads this number as `roomSize`.
export const ROOM_MAX_CLIENTS = 4; // one base seat each (client BASES.list)

// Longest accepted strings.
export const NAME_MAX = 64;
// Profile picture URL (Bloxity `pfp`), relayed so other players can draw it.
export const PFP_MAX_LEN = 512;

// Colyseus drops the whole connection for a WebSocket message above this (default 4 KB).
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// How long a dropped connection (WiFi blip, backgrounded tab) may reconnect with the same session.
export const RECONNECT_SECONDS = 20;

// Upper bounds for saved values, so a forged payload cannot store a bogus number. Generous
// ceilings, not game rules (the client's cash reaches ~1e21 and beyond).
export const CURRENCY_MAX = 1e33; // cash, strength
export const BEST_MAX = 1e9; // best climb, HUD metres
export const REBIRTHS_MAX = 1e9;
export const PAWS_MAX = 1e9;
export const GOAL_MAX = 1e12; // lobby goals: seconds played, eggs hatched
// Client RUN.hotbar: eggs in the hotbar are tier indexes into RUN.tiers.
export const HOTBAR_EGGS_MAX = 64;
export const EGG_TIERS_MAX = 64;
// Client FARM.maxEggs (20) placed eggs; pets owned on the plot and the bench.
export const PLACED_MAX = 64;
export const PETS_MAX = 2000;
export const BASE_LEVEL_MAX = 1000;
// Treadmill Shop (client WEIGHTS.list, 16) and the Index (INDEX eggs x pets x tabs).
export const OWNED_MAX = 256;
export const INDEX_MAX = 1024;
// Daily Rewards (client DAILY.days): days in one calendar cycle.
export const DAILY_DAYS = 7;

// Ids from the client's catalogs (pets, eggs, weights): short slugs, so nothing odd is stored.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
// Index "found" keys are "<tab>:<petId>".
export const FOUND_PATTERN = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$/;

// The client's guest ids (never persisted).
export const GUEST_ID_PREFIX = "guest-";

// Bloxity server stats (bloxity.ts): the saved fields reported to the game page, at most every
// STATS_EVERY_MS per room, and the rewarded-ad placements the client may claim.
export const STATS_EVERY_MS = 60 * 1000;
export const AD_PLACEMENTS = ["free-cash"] as const;

// Presence (presence.ts): each client sends its pose ~10/s and its Bloxity avatar look when it
// changes. The server only bounds them; it never parses the avatar JSON.
export const POSE_MIN_INTERVAL_MS = 60; // faster `pose` messages are dropped (the client sends every ~100 ms)
export const POSE_COORD_MAX = 100_000; // |x|, |y|, |z| in metres
export const POSE_SPEED_MAX = 100; // m/s
// A player's plot as shown to the others: { p: active pet ids, w: equipped weight id, r: rate text }.
export const BASE_PETS_MAX = 40;
export const BASE_ID_MAX = 40;
export const BASE_RATE_MAX = 24;
export const AVATAR_MAX_LEN = 4096; // JSON text of SDK.avatar.getEquipped() + proportions
