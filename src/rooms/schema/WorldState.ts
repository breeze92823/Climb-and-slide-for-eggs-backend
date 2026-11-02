import { schema, t, type SchemaType } from "@colyseus/schema";

// The live roster: who is in the room. Durable progress lives in Mongo (src/db.ts).
// To sync something new about a player, add a field here and accept it in a WorldRoom message.
export const PlayerState = schema(
  {
    username: t.string().default(""), // Bloxity displayName/username (verified when deployed)
    signedIn: t.boolean().default(false), // has a Bloxity id: only signed-in players are saved
    pfp: t.string().default(""), // Bloxity profile picture URL ("" = none)
    uid: t.string().default(""), // verified Bloxity account id ("" = guest): clients match chat bubbles (message.userId) to players with it
    // Presence (presence.ts): the client-sent pose, bounded, relayed so others can draw this player.
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0), // radians the character faces
    speed: t.float32().default(0), // horizontal m/s, drives the walk cycle
    posed: t.boolean().default(false), // sent at least one pose: nobody is drawn before it
    avatar: t.string().default(""), // Bloxity avatar look JSON, length-capped, never parsed here
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState), // keyed by sessionId
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
