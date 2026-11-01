import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const {SUPABASE_URL} = process.env;
const publicBucket = process.env.SUPABASE_PUBLIC_BUCKET ?? "amanecer-public";
const privateBucket = process.env.SUPABASE_PRIVATE_BUCKET ?? "amanecer-private";

if (!SUPABASE_URL) throw new Error("Falta configurar SUPABASE_URL.");

let s3;
function getS3Client() {
  const {SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY} = process.env;
  if (!SUPABASE_S3_ENDPOINT || !SUPABASE_S3_REGION || !SUPABASE_S3_ACCESS_KEY_ID || !SUPABASE_S3_SECRET_ACCESS_KEY) {
    throw new Error("Falta configurar Supabase Storage S3 en las variables SUPABASE_S3_*.");
  }
  s3 ??= new S3Client({
    endpoint: SUPABASE_S3_ENDPOINT,
    region: SUPABASE_S3_REGION,
    forcePathStyle: true,
    credentials: {accessKeyId: SUPABASE_S3_ACCESS_KEY_ID, secretAccessKey: SUPABASE_S3_SECRET_ACCESS_KEY},
  });
  return s3;
}

export const storageBuckets = {public: publicBucket, private: privateBucket};

export function publicStorageUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${publicBucket}/${encodedPath}`;
}

export async function uploadStorageObject(bucket, path, contents, contentType) {
  await getS3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    Body: contents,
    ContentType: contentType,
    CacheControl: "3600",
  }));
  return path;
}

export async function downloadStorageObject(bucket, path) {
  const response = await getS3Client().send(new GetObjectCommand({Bucket: bucket, Key: path}));
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function removeStorageObjects(bucket, paths) {
  const keys = paths.filter((path) => typeof path === "string" && path.length > 0);
  if (!keys.length) return;
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const response = await getS3Client().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {Objects: keys.slice(offset, offset + 1000).map((Key) => ({Key})), Quiet: true},
    }));
    if (response.Errors?.length) {
      throw new Error(`No se pudieron eliminar ${response.Errors.length} objetos de Supabase Storage.`);
    }
  }
}
