"use client";

import { LoaderCircle } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { ResellerStatsCard } from "./components/reseller-stats-card";
import { ResellerCustomersCard } from "./components/reseller-customers-card";
import { ResellerCustomerUsageCard } from "./components/reseller-customer-usage-card";

function ResellerDashboardContent() {
  return (
    <>
      <section className="mb-2 flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Reseller Dashboard</div>
          <h1 className="text-2xl font-semibold tracking-tight">分销商控制台</h1>
          <p className="text-sm text-stone-500">管理您的客户账号，查看用量统计，支持创建试用和付费客户。</p>
        </div>
      </section>
      <section className="space-y-5">
        <ResellerStatsCard />
        <ResellerCustomersCard />
        <ResellerCustomerUsageCard />
      </section>
    </>
  );
}

export default function ResellerDashboardPage() {
  const { isCheckingAuth, session } = useAuthGuard(["reseller"]);

  if (isCheckingAuth || !session || session.role !== "reseller") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ResellerDashboardContent />;
}
