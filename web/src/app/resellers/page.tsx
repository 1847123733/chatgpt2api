"use client";

import { LoaderCircle } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { ResellersCard } from "./components/resellers-card";
import { ResellerSettlementCard } from "./components/reseller-settlement-card";

function ResellersPageContent() {
  return (
    <>
      <section className="mb-2 flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Resellers</div>
          <h1 className="text-2xl font-semibold tracking-tight">代理商管理</h1>
          <p className="text-sm text-stone-500">管理代理商密钥，支持创建、禁用、续期和删除；可查看并记录结算信息。</p>
        </div>
      </section>
      <section className="space-y-5">
        <ResellersCard />
        <ResellerSettlementCard />
      </section>
    </>
  );
}

export default function ResellersPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ResellersPageContent />;
}
