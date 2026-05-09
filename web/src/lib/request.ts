import axios, {AxiosError, type AxiosRequestConfig} from "axios";

import webConfig from "@/constants/common-env";
import {clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession} from "@/store/auth";

type RequestConfig = AxiosRequestConfig & {
    redirectOnUnauthorized?: boolean;
    _sessionRecoveryRetried?: boolean;
};

type ErrorPayload = {
    detail?: string | { error?: string | { message?: string }; code?: string };
    error?: string | { message?: string; code?: string };
    message?: string;
    code?: string;
};

type LoginResponse = {
    role: "admin" | "user";
    subject_id: string;
    name: string;
    session_id?: string | null;
    expires_at?: string | null;
    remaining_days?: number | null;
};

function errorMessageFromValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return "";
    }

    const item = value as { error?: unknown; message?: unknown };
    if (typeof item.message === "string") {
        return item.message;
    }
    return errorMessageFromValue(item.error);
}

function errorCodeFromPayload(payload: ErrorPayload | undefined): string {
    const detail = payload?.detail;
    if (detail && typeof detail === "object" && typeof detail.code === "string") {
        return detail.code;
    }
    const error = payload?.error;
    if (error && typeof error === "object" && typeof error.code === "string") {
        return error.code;
    }
    return typeof payload?.code === "string" ? payload.code : "";
}

export const request = axios.create({
    baseURL: webConfig.apiUrl.replace(/\/$/, ""),
});

const sessionRecoveryRequest = axios.create({
    baseURL: webConfig.apiUrl.replace(/\/$/, ""),
});

async function recoverUserSession() {
    const storedSession = await getStoredAuthSession();
    if (!storedSession || storedSession.role !== "user") {
        return null;
    }

    const response = await sessionRecoveryRequest.post<LoginResponse>(
        "/auth/login",
        {},
        {
            headers: {
                Authorization: `Bearer ${storedSession.key}`,
            },
        },
    );
    const data = response.data;
    const nextSession = {
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
}

request.interceptors.request.use(async (config) => {
    const nextConfig = {...config};
    const storedSession = await getStoredAuthSession();
    const authKey = String(storedSession?.key || "").trim();
    const headers = {...(nextConfig.headers || {})} as Record<string, string>;
    if (authKey && !headers.Authorization) {
        headers.Authorization = `Bearer ${authKey}`;
    }
    if (storedSession?.sessionId && !headers["x-session-id"]) {
        headers["x-session-id"] = storedSession.sessionId;
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    nextConfig.headers = headers;
    return nextConfig;
});

request.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ErrorPayload>) => {
        const status = error.response?.status;
        const payload = error.response?.data;
        const errorCode = errorCodeFromPayload(payload);
        const requestConfig = error.config as RequestConfig | undefined;
        if (status === 401 && errorCode === "session_invalid" && requestConfig && !requestConfig._sessionRecoveryRetried) {
            try {
                const recoveredSession = await recoverUserSession();
                if (recoveredSession) {
                    requestConfig._sessionRecoveryRetried = true;
                    const headers = {...(requestConfig.headers || {})} as Record<string, string>;
                    headers.Authorization = `Bearer ${recoveredSession.key}`;
                    if (recoveredSession.sessionId) {
                        headers["x-session-id"] = recoveredSession.sessionId;
                    } else {
                        delete headers["x-session-id"];
                    }
                    requestConfig.headers = headers;
                    return request.request(requestConfig);
                }
            } catch {
                // Fall through to the normal unauthorized handling below.
            }
        }

        const shouldRedirect = requestConfig?.redirectOnUnauthorized !== false;
        const shouldClearAuth = errorCode !== "session_invalid" || !requestConfig || Boolean(requestConfig._sessionRecoveryRetried);
        if (status === 401 && shouldRedirect && shouldClearAuth && typeof window !== "undefined") {
            // Avoid redirect loop — only redirect if not already on /login
            if (!window.location.pathname.startsWith("/login")) {
                await clearStoredAuthSession();
                window.location.replace("/login");
                // Return a never-resolving promise to prevent further error handling
                // while the browser navigates away
                return new Promise(() => {});
            }
        }

        const message =
            errorMessageFromValue(payload?.detail) ||
            errorMessageFromValue(payload?.error) ||
            payload?.message ||
            error.message ||
            `请求失败 (${status || 500})`;
        const nextError = new Error(message) as Error & { code?: string; status?: number };
        nextError.code = errorCode || undefined;
        nextError.status = status;
        return Promise.reject(nextError);
    },
);

type RequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    redirectOnUnauthorized?: boolean;
};

export async function httpRequest<T>(path: string, options: RequestOptions = {}) {
    const {method = "GET", body, headers, redirectOnUnauthorized = true} = options;
    const config: RequestConfig = {
        url: path,
        method,
        data: body,
        headers,
        redirectOnUnauthorized,
    };
    const response = await request.request<T>(config);
    return response.data;
}
