import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../env";

let client: S3Client | null = null;

export function getS3(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  const env = getEnv();
  const s3 = getS3();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string) {
  const env = getEnv();
  await ensureBucket();
  await getS3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }),
  );
}

export async function getObjectText(key: string): Promise<string> {
  const env = getEnv();
  const out = await getS3().send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
  const str = await out.Body?.transformToString();
  if (str === undefined) throw new Error("Empty object body");
  return str;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const env = getEnv();
  const out = await getS3().send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
  const bytes = await out.Body?.transformToByteArray();
  if (!bytes) throw new Error("Empty object body");
  return Buffer.from(bytes);
}

export async function getSignedGetUrl(key: string, expiresSec = 3600): Promise<string> {
  const env = getEnv();
  const cmd = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(getS3(), cmd, { expiresIn: expiresSec });
}

export type ListedJsonObject = { key: string; lastModified: string | null };

/** List `.json` objects under `prefix`, newest first. Paginates until `maxKeys` matches or listing ends. */
export async function listJsonObjectsByPrefix(prefix: string, maxKeys: number): Promise<ListedJsonObject[]> {
  await ensureBucket();
  const bucket = getEnv().S3_BUCKET;
  const s3 = getS3();
  const acc: ListedJsonObject[] = [];
  let token: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (!obj.Key?.endsWith(".json")) continue;
      acc.push({
        key: obj.Key,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      });
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
    if (acc.length >= maxKeys * 4) break;
  } while (token);

  acc.sort((a, b) => {
    const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
    const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
    return tb - ta;
  });
  return acc.slice(0, maxKeys);
}

const DELETE_BATCH = 1000;

/** Deletes all objects whose keys start with `prefix` (e.g. `songs/uuid/`). */
export async function deleteObjectsByPrefix(prefix: string): Promise<void> {
  const env = getEnv();
  const s3 = getS3();
  await ensureBucket();
  let continuationToken: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (list.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const chunk = keys.slice(i, i + DELETE_BATCH);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

export function purgeSongStorage(songId: string): Promise<void> {
  return deleteObjectsByPrefix(`songs/${songId}/`);
}
