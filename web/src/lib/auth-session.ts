"use client";

import { login } from "@/lib/api";
import { clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

export async function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    return null;
  }

  try {
    const data = await login(storedSession.key, storedSession.sessionId);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
      sessionId: data.session_id ?? storedSession.sessionId ?? null,
      expiresAt: data.expires_at ?? storedSession.expiresAt ?? null,
      remainingDays: typeof data.remaining_days === "number" ? data.remaining_days : storedSession.remainingDays ?? null,
    };
    await setStoredAuthSession(nextSession);
    return nextSession;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
    const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
    console.warn("[auth-session] 验证失败:", { code, status, role: storedSession.role, error });
    if (code === "session_invalid" && (storedSession.role === "user" || storedSession.role === "reseller")) {
      try {
        console.warn("[auth-session] 尝试重新登录 (无session_id)...");
        const data = await login(storedSession.key);
        const nextSession: StoredAuthSession = {
          key: storedSession.key,
          role: data.role,
          subjectId: data.subject_id,
          name: data.name,
          sessionId: data.session_id ?? null,
          expiresAt: data.expires_at ?? storedSession.expiresAt ?? null,
          remainingDays: typeof data.remaining_days === "number" ? data.remaining_days : storedSession.remainingDays ?? null,
        };
        await setStoredAuthSession(nextSession);
        return nextSession;
      } catch (retryError) {
        console.warn("[auth-session] 重新登录也失败:", retryError);
        // Fall through to clearing the stale session below.
      }
    }
    await clearStoredAuthSession();
    return null;
  }
}
