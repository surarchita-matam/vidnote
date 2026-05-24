import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function withApi<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    if (err instanceof ApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("API error:", err);
    return jsonError("Internal server error", 500);
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
