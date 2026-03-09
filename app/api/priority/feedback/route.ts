import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { emailId, sender, senderDomain, subject, originalPriority, correctPriority, feedbackType } =
    await request.json();

  if (!emailId || !feedbackType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Upsert — one feedback row per user+email (most recent wins)
  const { error } = await supabaseAdmin.from("priority_feedback").upsert(
    {
      clerk_user_id: userId,
      email_id: emailId,
      sender,
      sender_domain: senderDomain,
      subject,
      original_priority: originalPriority,
      correct_priority: correctPriority,
      feedback_type: feedbackType,
    },
    { onConflict: "clerk_user_id,email_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
