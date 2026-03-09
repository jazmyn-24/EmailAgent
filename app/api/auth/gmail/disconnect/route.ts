import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", request.nextUrl.origin));

  await supabaseAdmin
    .from("gmail_tokens")
    .delete()
    .eq("clerk_user_id", userId);

  return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
}
