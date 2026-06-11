"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  GithubAuthProvider,
} from "firebase/auth";

const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
let auth: Auth | undefined;

export function getFirebaseAuth() {
  if (auth) {
    return auth;
  }

  const firebaseConfig = {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
      (useEmulator ? "demo-api-key" : undefined),
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      (useEmulator ? "demo-brainshare-shoebill.firebaseapp.com" : undefined),
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      (useEmulator ? "demo-brainshare-shoebill" : undefined),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
      (useEmulator ? "1:123456789:web:demo" : undefined),
  };
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);

  if (useEmulator && !auth.emulatorConfig) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }

  return auth;
}

export function getGithubProvider() {
  return new GithubAuthProvider();
}
