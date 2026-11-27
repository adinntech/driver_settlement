import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { AppError } from "../utils/AppError.js";

/** Everything lives under this folder, both in the local public folder and in the cloud bucket. */
export const STORAGE_ROOT = "driver_settlement";
export const VEHICLE_FOLDER = `${STORAGE_ROOT}/vehicles`;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type StorageKind = "local" | "space";

export interface Attachment {
  storage: StorageKind;
  key: string; // e.g. driver_settlement/vehicles/2026/<uuid>-rc.pdf
  name: string; // original file name, sanitised
  size: number;
  mimeType: string;
}

export interface StorageDriver {
  kind: StorageKind;
  save(buffer: Buffer, key: string, mimeType: string): Promise<void>;
}

/** Allowed uploads: extension -> mime type + magic bytes check, so a renamed file cannot slip through. */
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  ".pdf": { mime: "application/pdf", magic: (b) => b.subarray(0, 4).toString("latin1") === "%PDF" },
  ".jpg": { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".jpeg": { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".png": { mime: "image/png", magic: (b) => b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" },
  ".webp": { mime: "image/webp", magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};
export const ALLOWED_MIME = Array.from(new Set(Object.values(TYPES).map((t) => t.mime)));
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

export function sanitizeFileName(original: string): string {
  const base = path.basename(original.replace(/\\/g, "/"));
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|_+$/g, "").slice(0, 80);
  return `${stem || "file"}${ext}`;
}

export function validateUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined) {
  if (!file) throw new AppError("Choose a file to upload", 400);
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("File is too large (maximum 10 MB)", 413);
  if (file.size === 0) throw new AppError("The selected file is empty", 400);
  const ext = path.extname(file.originalname).toLowerCase();
  const t = TYPES[ext];
  if (!t) throw new AppError(`Only ${ALLOWED_EXTENSIONS.join(", ")} files are allowed`, 400);
  if (file.mimetype !== t.mime || !t.magic(file.buffer)) throw new AppError("File content does not match its type", 400);
  return { name: sanitizeFileName(file.originalname), mimeType: t.mime };
}

export const KEY_PATTERN = new RegExp(`^${VEHICLE_FOLDER}/\\d{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,100}$`);

export const makeKey = (name: string, now = new Date()): string => `${VEHICLE_FOLDER}/${now.getUTCFullYear()}/${randomUUID()}-${name}`;

// ---------------------------------------------------------------- drivers
export function createLocalDriver(rootDir: string): StorageDriver {
  return {
    kind: "local",
    async save(buffer, key) {
      const target = path.resolve(rootDir, key);
      if (!target.startsWith(path.resolve(rootDir) + path.sep)) throw new AppError("Invalid storage path", 400); // no traversal
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    },
  };
}

interface S3Like {
  send(command: unknown): Promise<unknown>;
}
export function createSpaceDriver(client: S3Like, bucket: string): StorageDriver {
  return {
    kind: "space",
    async save(buffer, key, mimeType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType, ACL: "public-read", CacheControl: "public, max-age=31536000" }));
    },
  };
}

let spaceClient: S3Client | null = null;

/** Picks the driver from STORAGE_TYPE (local | space). */
export function getStorage(): StorageDriver {
  const type = config.storage.type;
  if (type === "local") return createLocalDriver(config.storage.localDir);
  if (type === "space") {
    const s = config.storage.space;
    if (!s.key || !s.secret || !s.endpoint || !s.region || !s.bucket) throw new AppError("Cloud storage is not configured on the server", 500);
    spaceClient ??= new S3Client({ region: s.region, endpoint: s.endpoint, credentials: { accessKeyId: s.key, secretAccessKey: s.secret } });
    return createSpaceDriver(spaceClient, s.bucket);
  }
  throw new AppError(`Unsupported STORAGE_TYPE "${type}" (use local or space)`, 500);
}

export async function storeUpload(file: Parameters<typeof validateUpload>[0], driver: StorageDriver = getStorage()): Promise<Attachment> {
  const v = validateUpload(file);
  const key = makeKey(v.name);
  await driver.save(file!.buffer, key, v.mimeType);
  return { storage: driver.kind, key, name: v.name, size: file!.size, mimeType: v.mimeType };
}

/** Public URL of a stored file (local: served by this backend, space: CDN). */
export function attachmentUrl(a: Pick<Attachment, "storage" | "key">): string {
  if (a.storage === "space") return `${config.storage.space.cdnBase.replace(/\/$/, "")}/${a.key}`;
  return `${config.storage.publicBaseUrl.replace(/\/$/, "")}/files/${a.key}`;
}
