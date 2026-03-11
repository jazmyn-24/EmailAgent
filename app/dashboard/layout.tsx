import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import SidebarNav from "./SidebarNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("clerk_user_id")
    .eq("clerk_user_id", user?.id ?? "")
    .single();

  return (
    <div className="h-screen flex bg-zinc-50 font-sans antialiased text-zinc-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-white border-r border-zinc-200">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-100">
          <span className="w-2 h-2 rounded-full bg-violet-600" />
          <Link href="/" className="text-base font-bold tracking-tight text-zinc-900">
            MailMind
          </Link>
        </div>

        {/* Nav */}
        <SidebarNav />

        {/* Bottom: user + disconnect */}
        <div className="px-4 py-4 border-t border-zinc-100 space-y-2">
          {tokenRow && (
            <a
              href="/api/auth/gmail/disconnect"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Disconnect Gmail
            </a>
          )}
          <div className="flex items-center gap-2 px-3 py-1">
            <UserButton appearance={{ elements: { avatarBox: "w-7 h-7" } }} />
            <span className="text-xs text-zinc-500 truncate">
              {user?.firstName ?? user?.emailAddresses[0]?.emailAddress ?? "Account"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
