import {
  CURRENCY_MAX, BEST_MAX, REBIRTHS_MAX, PAWS_MAX, GOAL_MAX, HOTBAR_EGGS_MAX, EGG_TIERS_MAX, PLACED_MAX, PETS_MAX,
  BASE_LEVEL_MAX, OWNED_MAX, INDEX_MAX, ID_PATTERN, FOUND_PATTERN,
} from "./constants.js";
import type { PlayerDoc, PlacedEgg, SavedPet } from "./db.js";

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function clampNum(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}
export function clampInt(v: number, max: number, min = 0): number {
  return Math.min(max, Math.max(min, Math.floor(v)));
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

// Slug strings, no duplicates, bounded count.
export function sanitizeIds(raw: unknown, max = OWNED_MAX, pattern = ID_PATTERN): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && pattern.test(v)))].slice(0, max);
}

// Hotbar eggs: tier indexes (duplicates are fine: the same egg can be held twice).
function sanitizeEggs(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is number => Number.isInteger(t) && t >= 0 && t < EGG_TIERS_MAX).slice(0, HOTBAR_EGGS_MAX);
}

function sanitizePlaced(raw: unknown): PlacedEgg[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedEgg[] = [];
  for (const e of raw) {
    if (out.length >= PLACED_MAX) break;
    if (!isObject(e) || !Number.isInteger(e.tier) || (e.tier as number) < 0 || (e.tier as number) >= EGG_TIERS_MAX) continue;
    if (!finite(e.x) || !finite(e.z)) continue;
    out.push({ tier: e.tier as number, x: Math.max(-1e4, Math.min(1e4, e.x)), z: Math.max(-1e4, Math.min(1e4, e.z)) });
  }
  return out;
}

function sanitizePets(raw: unknown): SavedPet[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPet[] = [];
  for (const p of raw) {
    if (out.length >= PETS_MAX) break;
    if (isObject(p) && isId(p.id)) out.push({ id: p.id, on: p.on === true });
  }
  return out;
}

// The game is client-authoritative -- no server-side gameplay validation. What IS enforced:
// shape and bounds, so a malformed payload can never corrupt this player's own Mongo document.
// A forged number can only ever affect the sender's own save. Daily Reward fields are never
// accepted here (daily.ts owns them). Only the fields present in `raw` are returned.
export function sanitizeProgress(raw: unknown): Partial<PlayerDoc> | null {
  if (!isObject(raw)) return null;
  const out: Partial<PlayerDoc> = {};

  if (finite(raw.best)) out.best = clampNum(raw.best, BEST_MAX);
  if (finite(raw.strength)) out.strength = clampNum(raw.strength, CURRENCY_MAX);
  if (raw.eggs !== undefined) out.eggs = sanitizeEggs(raw.eggs);
  if (typeof raw.auto === "boolean") out.auto = raw.auto;

  if (finite(raw.cash)) out.cash = clampNum(raw.cash, CURRENCY_MAX);
  if (finite(raw.coins)) out.coins = clampInt(raw.coins, CURRENCY_MAX);
  if (finite(raw.cashAt)) out.cashAt = clampInt(raw.cashAt, Date.now() + 10 * 60 * 1000);

  if (raw.placed !== undefined) out.placed = sanitizePlaced(raw.placed);
  if (raw.pets !== undefined) out.pets = sanitizePets(raw.pets);
  if (finite(raw.baseLevel)) out.baseLevel = clampInt(raw.baseLevel, BASE_LEVEL_MAX);

  if (raw.weightsOwned !== undefined) out.weightsOwned = sanitizeIds(raw.weightsOwned);
  if (isId(raw.weightEquipped)) out.weightEquipped = raw.weightEquipped;
  if (out.weightsOwned && out.weightEquipped && !out.weightsOwned.includes(out.weightEquipped)) delete out.weightEquipped;

  if (raw.trailsOwned !== undefined) out.trailsOwned = sanitizeIds(raw.trailsOwned);
  if (isId(raw.trailEquipped)) out.trailEquipped = raw.trailEquipped;
  if (out.trailsOwned && out.trailEquipped && !out.trailsOwned.includes(out.trailEquipped)) delete out.trailEquipped;

  if (finite(raw.rebirths)) out.rebirths = clampInt(raw.rebirths, REBIRTHS_MAX);

  if (raw.indexEggs !== undefined) out.indexEggs = sanitizeIds(raw.indexEggs, INDEX_MAX);
  if (raw.indexFound !== undefined) out.indexFound = sanitizeIds(raw.indexFound, INDEX_MAX, FOUND_PATTERN);

  if (typeof raw.sellAuto === "boolean") out.sellAuto = raw.sellAuto;
  if (finite(raw.paws)) out.paws = clampInt(raw.paws, PAWS_MAX);
  if (finite(raw.goalPlayed)) out.goalPlayed = clampNum(raw.goalPlayed, GOAL_MAX);
  if (finite(raw.goalHatched)) out.goalHatched = clampInt(raw.goalHatched, GOAL_MAX);
  if (finite(raw.goalGiftAt)) out.goalGiftAt = clampNum(raw.goalGiftAt, GOAL_MAX);
  if (finite(raw.goalPaw)) out.goalPaw = clampInt(raw.goalPaw, GOAL_MAX);
  if (raw.goalDone !== undefined) out.goalDone = sanitizeIds(raw.goalDone);
  if (finite(raw.lastSeen)) out.lastSeen = clampInt(raw.lastSeen, Date.now() + 10 * 60 * 1000);
  return out;
}
