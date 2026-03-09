import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#0c0c0f] flex items-center justify-center">
      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-zinc-900/90 border border-zinc-800 shadow-xl",
          },
          variables: {
            colorPrimary: "#6366f1",
            colorBackground: "#18181b",
            colorInputBackground: "#27272a",
            colorInputText: "#fafafa",
            colorText: "#fafafa",
            colorTextSecondary: "#a1a1aa",
            borderRadius: "0.5rem",
          },
        }}
      />
    </div>
  );
}
