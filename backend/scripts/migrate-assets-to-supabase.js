import {readdir, readFile} from "node:fs/promises";
import {join, relative, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import pg from "pg";

const root = fileURLToPath(new URL("../../", import.meta.url));
const assetRoot = join(root, "backend", "assets", "imagenes");
const requiredStorageSettings = ["SUPABASE_URL", "SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION", "SUPABASE_S3_ACCESS_KEY_ID", "SUPABASE_S3_SECRET_ACCESS_KEY"];
const missingStorageSettings = requiredStorageSettings.filter((key) => !process.env[key]);
if (missingStorageSettings.length) throw new Error(`Faltan variables de Storage S3: ${missingStorageSettings.join(", ")}.`);
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "::1"].includes(dbUrl.hostname)) {
  throw new Error("La migración solo puede actualizar la base de datos local; DATABASE_URL no apunta a localhost.");
}
const supabase = new S3Client({
  endpoint: process.env.SUPABASE_S3_ENDPOINT,
  region: process.env.SUPABASE_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
  },
});
const publicBucket = process.env.SUPABASE_PUBLIC_BUCKET ?? "amanecer-public";
const privateBucket = process.env.SUPABASE_PRIVATE_BUCKET ?? "amanecer-private";
const {Pool} = pg;
const pool = new Pool({connectionString: process.env.DATABASE_URL});

async function listFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

function contentType(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

async function upload(bucket, objectPath, localPath) {
  await supabase.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectPath,
    Body: await readFile(localPath),
    ContentType: contentType(localPath),
    CacheControl: "3600",
  }));
}

const publicObjects = new Map();
for (const area of ["web", "habitaciones"]) {
  const base = join(assetRoot, area);
  for (const localPath of await listFiles(base)) {
    const relativePath = relative(base, localPath).split(sep).join("/");
    const objectPath = area === "web" ? `site/${relativePath}` : `rooms/${relativePath}`;
    await upload(publicBucket, objectPath, localPath);
    const objectArea = area === "web" ? "web" : "rooms";
    publicObjects.set(`${objectArea}/${relativePath}`, `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${publicBucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`);
  }
}

const privateObjects = new Map();
const privateBase = join(assetRoot, "pre-checking");
for (const localPath of await listFiles(privateBase)) {
  const relativePath = relative(privateBase, localPath).split(sep).join("/");
  const objectPath = `pre-checking/${relativePath}`;
  await upload(privateBucket, objectPath, localPath);
  privateObjects.set(`assets/imagenes/pre-checking/${relativePath}`, `storage:${objectPath}`);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS room_images (
      id SERIAL PRIMARY KEY,
      room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      object_path TEXT NOT NULL UNIQUE,
      image_url TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_images_room_position_idx ON room_images(room_id, position, id);
  `);

  for (const [settingKey, filename] of [
    ["hero_image_path", "hero.webp"],
    ["intro_image_path", "intro.webp"],
    ["experience_image_path", "experience.webp"],
  ]) {
    const imageUrl = publicObjects.get(`web/${filename}`);
    if (imageUrl) await client.query(
      `INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [settingKey, imageUrl],
    );
  }

  const ruralHouseImage = publicObjects.get("web/casa-rural.webp");
  if (ruralHouseImage) {
    await client.query("UPDATE rooms SET image_url = $1 WHERE slug = 'casa-rural'", [ruralHouseImage]);
  }

  const {rows: rooms} = await client.query("SELECT id, slug FROM rooms ORDER BY id");
  let roomImageCount = 0;
  for (const room of rooms) {
    const prefix = `rooms/${room.slug}/`;
    const roomImages = [...publicObjects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
    if (!roomImages.length) continue;
    await client.query("UPDATE rooms SET image_url = $2 WHERE id = $1", [room.id, roomImages[0][1]]);
    for (const [position, [key, imageUrl]] of roomImages.entries()) {
      const objectPath = key;
      await client.query(
        `INSERT INTO room_images (room_id, object_path, image_url, position) VALUES ($1, $2, $3, $4)
         ON CONFLICT (object_path) DO UPDATE SET image_url = EXCLUDED.image_url, position = EXCLUDED.position`,
        [room.id, objectPath, imageUrl, position],
      );
      roomImageCount += 1;
    }
  }

  for (const [oldPath, newPath] of privateObjects) {
    await client.query("UPDATE pre_checkings SET document_front_path = $2 WHERE document_front_path = $1", [oldPath, newPath]);
    await client.query("UPDATE pre_checkings SET document_back_path = $2 WHERE document_back_path = $1", [oldPath, newPath]);
  }
  await client.query("COMMIT");
  console.log(`Migración local completada: ${publicObjects.size} imágenes públicas, ${privateObjects.size} documentos privados y ${roomImageCount} fotos vinculadas a habitaciones.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
