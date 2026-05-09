"use client";

import { LoaderCircle } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { UserKeysCard } from "./components/user-keys-card";
import { UserKeyUsageCard } from "./components/user-key-usage-card";

function UserKeysPageContent() {
  return (
    <>
      <section className="mb-2 flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">User Keys</div>
          <h1 className="text-2xl font-semibold tracking-tight">用户密钥管理</h1>
          <p className="text-sm text-stone-500">集中管理普通用户访问密钥，支持创建、禁用、续期和删除。</p>
        </div>
      </section>
      <section className="space-y-5">
        <UserKeysCard />
        <UserKeyUsageCard />
      </section>
    </>
  );
}

export default function UserKeysPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <UserKeysPageContent />;
}
