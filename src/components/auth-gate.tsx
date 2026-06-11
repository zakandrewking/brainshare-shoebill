"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { LockKeyholeIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { AnswerWorkspace } from "@/components/answer-workspace";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFirebaseAuth,
  getGithubProvider,
} from "@/lib/firebase/client";

const allowedEmail = "zaking17@gmail.com";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d="M12 .7A11.3 11.3 0 0 0 8.4 22.8c.6.1.8-.3.8-.6v-2.3c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  async function handleSignIn() {
    setSigningIn(true);

    try {
      const auth = getFirebaseAuth();
      const result = await signInWithPopup(auth, getGithubProvider());
      const email = result.user.email?.toLowerCase();

      if (email !== allowedEmail) {
        await signOut(auth);
        toast.error(`Access is limited to ${allowedEmail}.`);
      }
    } catch (error) {
      console.error(error);
      toast.error("GitHub sign-in did not complete.");
    } finally {
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6">
        <div className="w-full space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-72 w-full" />
        </div>
      </main>
    );
  }

  if (user?.email?.toLowerCase() === allowedEmail) {
    return <AnswerWorkspace user={user} />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,oklch(0.7_0.14_260_/_0.16),transparent_45%)]" />
      <Card className="relative w-full max-w-md shadow-2xl shadow-black/5">
        <CardHeader className="gap-4">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <SparklesIcon className="size-5" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Brainshare</CardTitle>
            <CardDescription className="text-balance">
              Ask a question, shape the answer, and keep a precise record of
              what the model wrote and what you changed.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            size="lg"
            className="w-full"
            disabled={signingIn}
            onClick={handleSignIn}
          >
            <GithubIcon />
            {signingIn ? "Opening GitHub..." : "Continue with GitHub"}
          </Button>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <LockKeyholeIcon className="size-3.5" />
            Private preview for {allowedEmail}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
