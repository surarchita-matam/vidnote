import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { completeMultipartUpload } from "@/lib/s3";
import { withApi, ApiError } from "@/lib/api";

export async function POST(req: NextRequest) {
  return withApi(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      key?: string;
      uploadId?: string;
      parts?: { ETag: string; PartNumber: number }[];
    };
    if (!body.key || !body.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
      throw new ApiError("key, uploadId and parts are required");
    }
    if (!body.key.startsWith(`users/${user.id}/`)) {
      throw new ApiError("Key does not belong to this user", 403);
    }
    const sorted = [...body.parts].sort((a, b) => a.PartNumber - b.PartNumber);
    await completeMultipartUpload(body.key, body.uploadId, sorted);
    return { ok: true };
  });
}
