import { MongoClient, type Collection } from "mongodb";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

// The persisted client state (what `saveProgress` carries, see sanitize.ts). Flat on purpose, so
// the personal best can be a `$max` field. The client's src/saves.js maps each of its save
// sections (run, cash, farm, weights, rebirth, index, sell, daily) onto these names.
export interface PlayerDoc {
  _id: string; // Bloxity user id (verified token) -- see WorldRoom.ts
  username?: string; // display name as of the last save
  // Climb run (climbRun.js)
  best?: number; // best climb, HUD metres (only ever goes up)
  strength?: number;
  eggs?: number[]; // eggs in the hotbar: tier index per egg
  auto?: boolean; // Auto Climb
  // Lobby HUD (lobbyHud.js)
  cash?: number;
  cashAt?: number; // epoch ms the cash was saved: offline earnings are paid from it
  // The player's plot (baseFarm.js)
  placed?: PlacedEgg[];
  pets?: SavedPet[];
  baseLevel?: number;
  // Treadmill Shop (weightShop.js)
  weightsOwned?: string[];
  weightEquipped?: string;
  // Rebirth window
  rebirths?: number;
  // Index window (petIndex.js)
  indexEggs?: string[]; // egg ids revealed
  indexFound?: string[]; // "<tab>:<petId>"
  // Sell window
  sellAuto?: boolean;
  // Daily Rewards: paw coins won (the days themselves are server-owned, see below)
  paws?: number;
  lastSeen?: number; // epoch ms of the last activity
  // Daily Rewards (daily.ts): written by the server only, never by saveProgress.
  dailyDay?: number; // days unlocked this cycle
  dailyLast?: number; // UTC day index of the last unlock
  dailyClaimed?: number[]; // claimed day indexes this cycle
  // Set on a Bloxity guest's doc once its progress was carried into an account.
  carriedTo?: string;
  version: number;
  updatedAt: Date;
}

// One egg placed on the plot: its tier index and where.
export interface PlacedEgg {
  tier: number;
  x: number;
  z: number;
}

// One owned pet: its id (client INDEX / PLAYTIME.pets) and whether it is on the plot.
export interface SavedPet {
  id: string;
  on: boolean;
}

let client: MongoClient | null = null;
let players: Collection<PlayerDoc> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set -- player progress will not persist");
    return;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    // No dbName passed to .db() -- the injected URI already points at this game+channel's database.
    players = client.db().collection<PlayerDoc>("players");
    console.log("[db] connected to MongoDB");
  } catch (err) {
    console.warn("[db] connect failed -- player progress will not persist:", err);
    client = null;
    players = null;
  }
}

// Null whenever Mongo is unset/unreachable -- every caller must treat that as "skip persistence".
export function getPlayers(): Collection<PlayerDoc> | null {
  return players;
}

// Test-only seam: exercise the save/load logic against an in-memory fake collection.
export function __setPlayersForTest(fake: Collection<PlayerDoc> | null): void {
  players = fake;
}
