import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildObjectKey, createMultipartUpload } from "@/lib/s3";
import { withApi, ApiError } from "@/lib/api";

export async function POST(req: NextRequest) {
  return withApi(async () => {
    const user = await requireUser();
    const body = (await req.json()) as { filename?: string; contentType?: string };
    if (!body.filename || !body.contentType) {
      throw new ApiError("filename and contentType are required");
    }
    if (!body.contentType.startsWith("video/")) {
      throw new ApiError("File must be a video.");
    }
    const key = buildObjectKey(user.id, body.filename);
    const uploadId = await createMultipartUpload(key, body.contentType);
    return { key, uploadId };
  });
}
