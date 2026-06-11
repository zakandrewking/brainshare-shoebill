"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from "firebase/auth";
import { toast } from "sonner";

import { AnswerWorkspace } from "@/components/answer-workspace";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFirebaseAuth,
  getGithubProvider,
} from "@/lib/firebase/client";

const allowedEmail = "zaking17@gmail.com";

// Popup failures that warrant a full-page redirect retry instead (popups are
// flaky on production — blockers, mobile, and Cross-Origin-Opener-Policy).
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/popup-closed-by-user",
  "auth/operation-not-supported-in-environment",
  "auth/web-storage-unsupported",
]);

// Turn a Firebase auth error into a message that names the real cause, so a
// broken prod sign-in is diagnosable instead of a generic failure.
function describeAuthError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  switch (code) {
    case "auth/unauthorized-domain":
      return "This domain isn't authorized for sign-in. Add it in Firebase → Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "GitHub sign-in isn't enabled for this Firebase project.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with a different sign-in method.";
    case "auth/network-request-failed":
      return "Network error reaching Firebase. Check connectivity and try again.";
    default:
      return code
        ? `GitHub sign-in failed (${code}).`
        : "GitHub sign-in did not complete.";
  }
}

// Enforce the email allowlist on the client (the server enforces it too).
async function enforceAllowlist(auth: Auth, credential: UserCredential) {
  const email = credential.user.email?.toLowerCase();
  if (email !== allowedEmail) {
    await signOut(auth);
    toast.error(`Access is limited to ${allowedEmail}.`);
  }
}

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
    const auth = getFirebaseAuth();
    // Complete a redirect-based sign-in (used as a popup fallback) on return.
    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          void enforceAllowlist(auth, result);
        }
      })
      .catch((error) => {
        console.error(error);
        toast.error(describeAuthError(error));
      });

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    // Never hang on the splash: if auth initialization stalls, fall back to the
    // signed-out view after a few seconds so sign-in stays reachable.
    const timeout = setTimeout(() => setLoading(false), 6000);
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSignIn() {
    setSigningIn(true);
    const auth = getFirebaseAuth();

    try {
      const result = await signInWithPopup(auth, getGithubProvider());
      await enforceAllowlist(auth, result);
    } catch (error) {
      console.error(error);
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;

      if (code && POPUP_FALLBACK_CODES.has(code)) {
        // Retry with a full-page redirect; the result is handled on return.
        try {
          await signInWithRedirect(auth, getGithubProvider());
          return;
        } catch (redirectError) {
          console.error(redirectError);
          toast.error(describeAuthError(redirectError));
        }
      } else {
        toast.error(describeAuthError(error));
      }
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16">
      <Card className="relative w-full max-w-md">
        <CardHeader className="gap-4">
          <Image
            src="/robot-csv.png"
            alt="Brainshare robot"
            width={128}
            height={128}
            unoptimized
            priority
            className="size-32 [image-rendering:pixelated]"
          />
          <CardTitle className="text-xl">Brainshare</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            className="w-full"
            disabled={signingIn}
            onClick={handleSignIn}
          >
            <GithubIcon />
            {signingIn ? "Opening GitHub..." : "Continue with GitHub"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
