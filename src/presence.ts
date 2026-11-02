import { AVATAR_MAX_LEN, BASE_ID_MAX, BASE_PETS_MAX, BASE_RATE_MAX, POSE_COORD_MAX, POSE_SPEED_MAX } from "./constants.js";

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  anim: number; // bit flags: 1 sliding, 2 carrying overhead, 4 carrying in hand, 8 lifting
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TAU = 2 * Math.PI;

/** A bounded pose from a client message, or null when it is not one (a missing field rejects it). */
export function sanitizePose(raw: unknown): Pose | null {
  const m = raw as Partial<Record<keyof Pose, unknown>> | null;
  if (!m || typeof m !== "object") return null;
  const { x, y, z, yaw, speed, anim } = m;
  if (!finite(x) || !finite(y) || !finite(z) || !finite(yaw) || !finite(speed)) return null;
  return {
    x: clamp(x, -POSE_COORD_MAX, POSE_COORD_MAX),
    y: clamp(y, -POSE_COORD_MAX, POSE_COORD_MAX),
    z: clamp(z, -POSE_COORD_MAX, POSE_COORD_MAX),
    yaw: ((((yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI,
    speed: clamp(speed, 0, POSE_SPEED_MAX),
    anim: finite(anim) ? Math.trunc(clamp(anim, 0, 15)) : 0,
  };
}

/** The avatar look as sent ({ look } JSON text, relayed untouched), or null when not a string within the cap. */
export function sanitizeAvatar(raw: unknown): string | null {
  const s = (raw as { look?: unknown } | null)?.look;
  return typeof s === "string" && s.length <= AVATAR_MAX_LEN ? s : null;
}

const ID = /^[A-Za-z0-9_-]+$/;

/** The plot summary as JSON text ({ p: pet ids, w: weight id, r: rate text }), rebuilt from the message so only bounded values are relayed; null when not one. */
export function sanitizeBase(raw: unknown): string | null {
  const m = raw as { p?: unknown; w?: unknown; r?: unknown } | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.p)) return null;
  const p = m.p.filter((id): id is string => typeof id === "string" && id.length <= BASE_ID_MAX && ID.test(id)).slice(0, BASE_PETS_MAX);
  const w = typeof m.w === "string" && m.w.length <= BASE_ID_MAX && ID.test(m.w) ? m.w : "";
  const r = typeof m.r === "string" ? m.r.slice(0, BASE_RATE_MAX) : "";
  return JSON.stringify({ p, w, r });
}
