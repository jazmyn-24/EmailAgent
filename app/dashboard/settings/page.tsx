import { currentUser } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export default async function SettingsPage() {
  const user = await currentUser();

  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("clerk_user_id")
    .eq("clerk_user_id", user?.id ?? "")
    .single();

  const email = user?.emailAddresses[0]?.emailAddress ?? "";

  return (
    <div className="h-full overflow-y-auto bg-zinc-50">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your account and connections.</p>
        </div>

        {/* Account section */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 mb-4">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Account</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-zinc-100">
              <span className="text-sm text-zinc-600">Name</span>
              <span className="text-sm font-medium text-zinc-900">
                {user?.firstName} {user?.lastName}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-600">Email</span>
              <span className="text-sm font-medium text-zinc-900">{email}</span>
            </div>
          </div>
        </div>

        {/* Gmail connection */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Gmail Connection</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${tokenRow ? "bg-emerald-500" : "bg-zinc-300"}`} />
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {tokenRow ? "Connected" : "Not connected"}
                </p>
                {tokenRow && (
                  <p className="text-xs text-zinc-400">Gmail account is linked</p>
                )}
              </div>
            </div>
            {tokenRow ? (
              <a
                href="/api/auth/gmail/disconnect"
                className="text-xs font-medium text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-3 py-1.5 transition-colors"
              >
                Disconnect
              </a>
            ) : (
              <a
                href="/api/auth/gmail"
                className="text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 transition-colors"
              >
                Connect Gmail
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
