import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION || "us-east-1";

export const s3 = new S3Client({
  region,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const BUCKET = process.env.S3_BUCKET || "";

export async function presignPut(key: string, contentType: string, expiresInSec = 3600) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

export async function presignGet(key: string, expiresInSec = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export function buildObjectKey(userId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  const safeExt = (ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const uuid = crypto.randomUUID();
  return `users/${userId}/${uuid}.${safeExt}`;
}

export async function createMultipartUpload(key: string, contentType: string) {
  const res = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  );
  if (!res.UploadId) throw new Error("Failed to create multipart upload");
  return res.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresInSec = 3600
) {
  const cmd = new UploadPartCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec, unhoistableHeaders: new Set() });
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
) {
  return s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  return s3.send(
    new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })
  );
}
