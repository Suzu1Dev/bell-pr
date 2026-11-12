/**
 * Device tokens: revocable credentials that a paired phone or computer
 * sends instead of the install's API token, in the same headers
 * (`Authorization: Bearer bpd_…` or `X-Bell-Token`).
 *
 * `<dataDir>/devices.json` (mode 0600) keeps only sha256(token), an id, a
 * name and two dates per device; the token itself appears once, in the
 * pairing response. The file also records a digest of the install token
 * the devices were paired under: after `bell-pr token rotate` that digest
 * no longer matches, so every device token stops working even if a stale
 * write brought a record back.
 *
 * The server reads the file on every request, so a revocation, or a rotate
 * by the CLI in another process, applies at once.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { deviceTokenPrefix, type DeviceSummary } from "../shared/pairing.js";
import { dataPaths } from "./config.js";
import { writeDurable } from "./fs-atomic.js";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";

const deviceTokenPattern = /^bpd_[0-9a-f]{64}$/;
const deviceIdPattern = /^dev_[0-9a-f]{32}$/;
const hexDigest = /^[0-9a-f]{64}$/;
/** lastUsedAt is written at most once a minute per device. */
export const lastUsedWriteInterval = 60_000;

const deviceSchema = z
  .object({
    id: z.string().regex(deviceIdPattern),
    name: z.string().min(1).max(64),
    tokenHash: z.string().regex(hexDigest),
    createdAt: z.string(),
    lastUsedAt: z.string().optional(),
  })
  .strict();
const devicesFileSchema = z
  .object({
    installDigest: z.string().regex(hexDigest).optional(),
    devices: z.array(deviceSchema),
  })
  .strict();
const devicesReadSchema = lenientRead(devicesFileSchema);
type DevicesFile = z.infer<typeof devicesFileSchema>;
type DeviceRecord = z.infer<typeof deviceSchema>;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Ties pairing state to one install token without storing it. */
export function installDigest(installToken: string): string {
  return sha256Hex(`bellpr-devices:v1\n${installToken}`);
}

/** Equal-length digests compared in constant time. */
export function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** Missing or damaged: no devices, so no device token is accepted. */
function readDevicesFile(file: string): DevicesFile {
  try {
    return devicesReadSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { devices: [] };
  }
}

/** The devices paired under this install token; none after a rotate. */
function currentDevices(file: string, installToken: string): DeviceRecord[] {
  const content = readDevicesFile(file);
  return content.installDigest === installDigest(installToken) ? content.devices : [];
}

async function writeDevicesFile(file: string, content: DevicesFile) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeDurable(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
}

/** Empties the device list. `bell-pr token rotate` calls it from another process. */
export async function clearDevices(dataDir: string): Promise<void> {
  await writeDevicesFile(dataPaths(dataDir).devices, { devices: [] });
}

export class DeviceTokens {
  private readonly file: string;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  /** When each device's lastUsedAt was last scheduled for writing. */
  private readonly touched = new Map<string, number>();

  constructor(dataDir: string, opts: { now?: () => number } = {}) {
    this.file = dataPaths(dataDir).devices;
    this.now = opts.now ?? Date.now;
  }

  /** Read-modify-write steps of this process run one at a time. */
  private serialize<T>(step: () => Promise<T>): Promise<T> {
    const result = this.queue.then(step);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * The id of the device that owns `presented`, or undefined. Every stored
   * hash is compared in constant time.
   */
  verify(presented: string, installToken: string): string | undefined {
    if (!deviceTokenPattern.test(presented)) return undefined;
    const hash = sha256Hex(presented);
    let found: DeviceRecord | undefined;
    for (const device of currentDevices(this.file, installToken))
      if (digestsMatch(device.tokenHash, hash)) found = device;
    if (found) this.touch(found, installToken);
    return found?.id;
  }

  /** Records the use, at most once per lastUsedWriteInterval per device. */
  private touch(device: DeviceRecord, installToken: string) {
    const now = this.now();
    const last = this.touched.get(device.id) ?? (device.lastUsedAt ? Date.parse(device.lastUsedAt) : NaN);
    if (now - last < lastUsedWriteInterval) return;
    this.touched.set(device.id, now);
    void this.serialize(async () => {
      const content = readDevicesFile(this.file);
      if (content.installDigest !== installDigest(installToken)) return;
      const record = content.devices.find((entry) => entry.id === device.id);
      // Revoked in the meantime: nothing to update, nothing to bring back.
      if (!record) return;
      record.lastUsedAt = new Date(now).toISOString();
      await writeDevicesFile(this.file, content);
    }).catch((error) => log.warn("Could not record a device's last use", { error }));
  }

  list(installToken: string, currentId?: string): DeviceSummary[] {
    return currentDevices(this.file, installToken).map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt ?? null,
      current: device.id === currentId,
    }));
  }

  /** Adds a device and returns its token; the token is not stored. */
  add(name: string, installToken: string): Promise<{ id: string; token: string; name: string }> {
    return this.serialize(async () => {
      const digest = installDigest(installToken);
      const content = readDevicesFile(this.file);
      const devices = content.installDigest === digest ? content.devices : [];
      const id = `dev_${randomBytes(16).toString("hex")}`;
      const token = `${deviceTokenPrefix}${randomBytes(32).toString("hex")}`;
      devices.push({ id, name, tokenHash: sha256Hex(token), createdAt: new Date(this.now()).toISOString() });
      await writeDevicesFile(this.file, { installDigest: digest, devices });
      return { id, token, name };
    });
  }

  /** False when no device has this id. */
  revoke(id: string, installToken: string): Promise<boolean> {
    return this.serialize(async () => {
      const content = readDevicesFile(this.file);
      if (content.installDigest !== installDigest(installToken)) return false;
      const devices = content.devices.filter((device) => device.id !== id);
      if (devices.length === content.devices.length) return false;
      this.touched.delete(id);
      await writeDevicesFile(this.file, { ...content, devices });
      return true;
    });
  }
}
