import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { abortMultipartUpload } from "@/lib/s3";
import { withApi, ApiError } from "@/lib/api";

export async function POST(req: NextRequest) {
  return withApi(async () => {
    const user = await requireUser();
    const body = (await req.json()) as { key?: string; uploadId?: string };
    if (!body.key || !body.uploadId) {
      throw new ApiError("key and uploadId are required");
    }
    if (!body.key.startsWith(`users/${user.id}/`)) {
      throw new ApiError("Key does not belong to this user", 403);
    }
    await abortMultipartUpload(body.key, body.uploadId);
    return { ok: true };
  });
}
