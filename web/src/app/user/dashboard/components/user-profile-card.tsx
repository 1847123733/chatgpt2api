"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, LoaderCircle, User } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchUserProfile } from "@/lib/api";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type UserProfile = {
  name?: string | null;
  status?: string | null;
  tier_name?: string | null;
  remaining_days?: number | null;
  monthly_usage?: number | null;
  monthly_limit?: number | null;
  daily_usage?: number | null;
  daily_limit?: number | null;
  last_used_at?: string | null;
  owner_name?: string | null;
};

export function UserProfileCard() {
  const didLoadRef = useRef(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUserProfile();
      setProfile(data.item as UserProfile);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户信息失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void load();
  }, []);

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center py-16">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="py-16 text-center text-sm text-stone-500">
          无法加载用户信息，请稍后重试。
        </CardContent>
      </Card>
    );
  }

  const isTrial = profile.status === "trial";
  const isPaid = profile.status === "paid";
  const remainingDays = typeof profile.remaining_days === "number" ? profile.remaining_days : null;

  // Usage display
  let usageCurrent = 0;
  let usageLimit = 0;
  let usageLabel = "";

  if (isTrial) {
    usageCurrent = profile.daily_usage ?? 0;
    usageLimit = profile.daily_limit ?? 10;
    usageLabel = "今日用量";
  } else {
    usageCurrent = profile.monthly_usage ?? 0;
    usageLimit = profile.monthly_limit ?? 0;
    usageLabel = "本月用量";
  }

  const usagePercent = usageLimit > 0 ? Math.min(100, Math.round((usageCurrent / usageLimit) * 100)) : 0;

  // Tier display
  let tierDisplay = profile.tier_name ?? "—";
  if (isTrial) {
    tierDisplay = `试用 - ${profile.daily_limit ?? 10}张/天`;
  }

  // Expiry color
  let expiryColor = "text-stone-700";
  if (remainingDays !== null) {
    if (remainingDays <= 0) {
      expiryColor = "text-rose-600";
    } else if (remainingDays <= 3) {
      expiryColor = "text-amber-600";
    }
  }

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
              <User className="size-5 text-stone-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">用户信息</h2>
              <p className="text-sm text-stone-500">查看您的账户状态与用量信息。</p>
            </div>
          </div>
          <Badge variant={isPaid ? "success" : isTrial ? "warning" : "secondary"} className="rounded-md">
            {isPaid ? "正式" : isTrial ? "试用" : profile.status ?? "未知"}
          </Badge>
        </div>

        {/* Expiry warning banner for trial users */}
        {isTrial && remainingDays !== null && remainingDays <= 1 && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {remainingDays <= 0
                ? "试用已到期，请联系管理员升级。"
                : `试用将于明天到期，请尽快联系管理员。`}
            </span>
          </div>
        )}

        {/* Info grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Name */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-stone-500">名称</div>
            <div className="text-sm font-medium text-stone-800">{profile.name ?? "—"}</div>
          </div>

          {/* Tier */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-stone-500">套餐</div>
            <div className="text-sm font-medium text-stone-800">{tierDisplay}</div>
          </div>

          {/* Remaining days */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-stone-500">剩余有效期</div>
            <div className={`text-sm font-medium ${expiryColor}`}>
              {remainingDays !== null ? (
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {remainingDays <= 0 ? "已过期" : `${remainingDays} 天`}
                </span>
              ) : (
                "—"
              )}
            </div>
          </div>

          {/* Last used */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-stone-500">最近使用</div>
            <div className="text-sm font-medium text-stone-800">{formatDateTime(profile.last_used_at)}</div>
          </div>

          {/* Owner */}
          {profile.owner_name && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-stone-500">所属代理</div>
              <div className="text-sm font-medium text-stone-800">{profile.owner_name}</div>
            </div>
          )}
        </div>

        {/* Usage progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-stone-700">{usageLabel}</span>
            <span className="text-stone-500">
              {usageCurrent} / {usageLimit > 0 ? usageLimit : "∞"}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                usagePercent >= 90 ? "bg-rose-500" : usagePercent >= 70 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${usageLimit > 0 ? usagePercent : 0}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
