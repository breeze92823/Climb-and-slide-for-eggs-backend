import { AVATAR_MAX_LEN, POSE_COORD_MAX, POSE_SPEED_MAX } from "./constants.js";

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TAU = 2 * Math.PI;

/** A bounded pose from a client message, or null when it is not one (a missing field rejects it). */
export function sanitizePose(raw: unknown): Pose | null {
  const m = raw as Partial<Record<keyof Pose, unknown>> | null;
  if (!m || typeof m !== "object") return null;
  const { x, y, z, yaw, speed } = m;
  if (!finite(x) || !finite(y) || !finite(z) || !finite(yaw) || !finite(speed)) return null;
  return {
    x: clamp(x, -POSE_COORD_MAX, POSE_COORD_MAX),
    y: clamp(y, -POSE_COORD_MAX, POSE_COORD_MAX),
    z: clamp(z, -POSE_COORD_MAX, POSE_COORD_MAX),
    yaw: ((((yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI,
    speed: clamp(speed, 0, POSE_SPEED_MAX),
  };
}

/** The avatar look as sent ({ look } JSON text, relayed untouched), or null when not a string within the cap. */
export function sanitizeAvatar(raw: unknown): string | null {
  const s = (raw as { look?: unknown } | null)?.look;
  return typeof s === "string" && s.length <= AVATAR_MAX_LEN ? s : null;
}
