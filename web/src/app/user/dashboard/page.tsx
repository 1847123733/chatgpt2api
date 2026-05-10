"use client";

import { LoaderCircle } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { UserProfileCard } from "./components/user-profile-card";

function DashboardPageContent() {
  return (
    <>
      <section className="mb-2 flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Dashboard</div>
          <h1 className="text-2xl font-semibold tracking-tight">个人中心</h1>
          <p className="text-sm text-stone-500">查看账户状态、用量信息和到期时间。</p>
        </div>
      </section>
      <section className="space-y-5">
        <UserProfileCard />
      </section>
    </>
  );
}

export default function UserDashboardPage() {
  const { isCheckingAuth, session } = useAuthGuard(["user"]);

  if (isCheckingAuth || !session || session.role !== "user") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <DashboardPageContent />;
}
