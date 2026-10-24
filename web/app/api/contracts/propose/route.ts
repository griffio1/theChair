import { NextResponse } from "next/server";
import type { ProposeContractRequest } from "../../../../../shared/types";
import { proposeContract } from "../../../../../server/propose";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as ProposeContractRequest;
  return NextResponse.json(await proposeContract(body));
}
