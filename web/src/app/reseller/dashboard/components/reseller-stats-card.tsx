"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchResellerStats } from "@/lib/api";

const RESELLER_CUSTOMERS_CHANGED_EVENT = "reseller-customers-changed";

type Stats = {
  total_customers?: number;
  active_customers?: number;
  trial_customers?: number;
  paid_customers?: number;
  max_trial_keys?: number;
  trial_quota_remaining?: number;
  total?: number;
  active?: number;
  trial?: number;
  paid?: number;
  [key: string]: unknown;
};

function MetricBlock({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "success" | "danger" | "info" }) {
  const toneClass = {
    default: "bg-stone-50 text-stone-900",
    success: "bg-emerald-50 text-emerald-800",
    danger: "bg-rose-50 text-rose-800",
    info: "bg-sky-50 text-sky-800",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl px-4 py-3 ${toneClass}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function numericStat(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function ResellerStatsCard() {
  const didLoadRef = useRef(false);
  const [stats, setStats] = useState<Stats>({});
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchResellerStats();
      setStats(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载统计数据失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void load();
  }, []);

  useEffect(() => {
    const handleCustomersChanged = () => {
      void load();
    };
    window.addEventListener(RESELLER_CUSTOMERS_CHANGED_EVENT, handleCustomersChanged);
    return () => window.removeEventListener(RESELLER_CUSTOMERS_CHANGED_EVENT, handleCustomersChanged);
  }, []);

  const totalCustomers = numericStat(stats.total_customers, stats.total);
  const activeCustomers = numericStat(stats.active_customers, stats.active);
  const trialCustomers = numericStat(stats.trial_customers, stats.trial);
  const paidCustomers = numericStat(stats.paid_customers, stats.paid);
  const maxTrialKeys = numericStat(stats.max_trial_keys);
  const trialQuotaRemaining = numericStat(stats.trial_quota_remaining, maxTrialKeys - trialCustomers);

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-6 p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
              <Users className="size-5 text-stone-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">分销概览</h2>
              <p className="text-sm text-stone-500">查看您的客户统计和试用配额使用情况。</p>
            </div>
          </div>
          <Button variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => void load()} disabled={isLoading}>
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <LoaderCircle className="size-5 animate-spin text-stone-400" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricBlock label="总客户数" value={totalCustomers} />
            <MetricBlock label="活跃客户" value={activeCustomers} tone="success" />
            <MetricBlock label="试用客户" value={trialCustomers} tone="info" />
            <MetricBlock label="付费客户" value={paidCustomers} tone="default" />
            <MetricBlock label="最大试用数" value={maxTrialKeys} />
            <MetricBlock label="试用配额剩余" value={trialQuotaRemaining} tone={trialQuotaRemaining === 0 ? "danger" : "success"} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
