"use client";

import { login } from "@/lib/api";
import { clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

export async function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    return null;
  }

  try {
    const data = await login(storedSession.key);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
      expiresAt: data.expires_at ?? storedSession.expiresAt ?? null,
      remainingDays: typeof data.remaining_days === "number" ? data.remaining_days : storedSession.remainingDays ?? null,
    };
    await setStoredAuthSession(nextSession);
    return nextSession;
  } catch {
    await clearStoredAuthSession();
    return null;
  }
}
