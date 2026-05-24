import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { presignUploadPart } from "@/lib/s3";
import { withApi, ApiError } from "@/lib/api";

export async function POST(req: NextRequest) {
  return withApi(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      key?: string;
      uploadId?: string;
      partNumber?: number;
    };
    if (!body.key || !body.uploadId || !body.partNumber) {
      throw new ApiError("key, uploadId and partNumber are required");
    }
    if (!body.key.startsWith(`users/${user.id}/`)) {
      throw new ApiError("Key does not belong to this user", 403);
    }
    if (body.partNumber < 1 || body.partNumber > 10000) {
      throw new ApiError("partNumber out of range");
    }
    const url = await presignUploadPart(body.key, body.uploadId, body.partNumber);
    return { url };
  });
}
