"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Copy, KeyRound, LoaderCircle, LogOut, Pencil, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  convertTrialToPaid,
  createResellerCustomer,
  clearResellerCustomerSessions,
  fetchResellerCustomers,
  updateResellerCustomer,
  type ResellerCustomer,
} from "@/lib/api";

const TIER_OPTIONS = [
  { value: "100", label: "100 次/月" },
  { value: "200", label: "200 次/月" },
  { value: "300", label: "300 次/月" },
  { value: "unlimited", label: "不限制" },
];

const UNLIMITED_TIER = "unlimited";
const FIXED_TIER_VALID_DAYS = 30;
const RESELLER_CUSTOMERS_CHANGED_EVENT = "reseller-customers-changed";

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatRemainingDays(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${Math.max(0, Math.floor(parsed))} 天`;
}

function tierLabel(tier: string) {
  return TIER_OPTIONS.find((t) => t.value === tier)?.label || tier;
}

function canEditValidDays(tier: string) {
  return tier === UNLIMITED_TIER;
}

function notifyCustomersChanged() {
  window.dispatchEvent(new Event(RESELLER_CUSTOMERS_CHANGED_EVENT));
}

export function ResellerCustomersCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<ResellerCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [revealedKey, setRevealedKey] = useState("");

  // Create dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createIsTrial, setCreateIsTrial] = useState(false);
  const [createTier, setCreateTier] = useState("200");
  const [createValidDays, setCreateValidDays] = useState("30");
  const [createMaxSessions, setCreateMaxSessions] = useState("4");
  const [isCreating, setIsCreating] = useState(false);

  // Edit dialog
  const [editingItem, setEditingItem] = useState<ResellerCustomer | null>(null);
  const [editName, setEditName] = useState("");
  const [editTier, setEditTier] = useState("200");
  const [editMaxSessions, setEditMaxSessions] = useState("4");

  // Renew dialog
  const [renewingItem, setRenewingItem] = useState<ResellerCustomer | null>(null);
  const [renewDays, setRenewDays] = useState("30");

  // Convert dialog
  const [convertingItem, setConvertingItem] = useState<ResellerCustomer | null>(null);
  const [convertTier, setConvertTier] = useState("200");
  const [convertValidDays, setConvertValidDays] = useState("30");

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchResellerCustomers();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载客户列表失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void load();
  }, []);

  const setItemPending = (id: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleCreate = async () => {
    setIsCreating(true);
    const validDays = canEditValidDays(createTier)
      ? Math.max(1, Math.floor(Number(createValidDays) || FIXED_TIER_VALID_DAYS))
      : FIXED_TIER_VALID_DAYS;
    try {
      const data = await createResellerCustomer(
        createName.trim(),
        createIsTrial,
        createIsTrial ? "trial" : createTier,
        createIsTrial ? 1 : validDays,
        Math.max(1, Math.floor(Number(createMaxSessions) || 4)),
      );
      setItems((prev) => [...prev, data.item]);
      setRevealedKey(data.key);
      setCreateName("");
      setCreateIsTrial(false);
      setCreateTier("200");
      setCreateValidDays("30");
      setCreateMaxSessions("4");
      setIsCreateOpen(false);
      notifyCustomersChanged();
      toast.success("客户已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建客户失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (item: ResellerCustomer) => {
    setItemPending(item.id, true);
    try {
      const data = await updateResellerCustomer(item.id, { enabled: !item.enabled });
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      notifyCustomersChanged();
      toast.success(item.enabled ? "客户已禁用" : "客户已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新客户失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const openEditDialog = (item: ResellerCustomer) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditTier(item.tier || "200");
    setEditMaxSessions(String(Math.max(1, Number(item.max_sessions) || 4)));
  };

  const handleEdit = async () => {
    if (!editingItem) return;
    const item = editingItem;
    setItemPending(item.id, true);
    try {
      const data = await updateResellerCustomer(item.id, {
        name: editName.trim(),
        tier: editTier,
        max_sessions: Math.max(1, Math.floor(Number(editMaxSessions) || 4)),
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      setEditingItem(null);
      notifyCustomersChanged();
      toast.success("客户信息已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新客户失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleRenew = async () => {
    if (!renewingItem) return;
    const item = renewingItem;
    const days = Math.max(1, Math.floor(Number(renewDays) || 30));
    setItemPending(item.id, true);
    try {
      const data = await updateResellerCustomer(item.id, { renew_days: days });
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      setRenewingItem(null);
      notifyCustomersChanged();
      toast.success("已续期");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "续期失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleConvert = async () => {
    if (!convertingItem) return;
    const item = convertingItem;
    const days = canEditValidDays(convertTier)
      ? Math.max(1, Math.floor(Number(convertValidDays) || FIXED_TIER_VALID_DAYS))
      : FIXED_TIER_VALID_DAYS;
    setItemPending(item.id, true);
    try {
      const data = await convertTrialToPaid(item.id, convertTier, days);
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      setConvertingItem(null);
      notifyCustomersChanged();
      toast.success("已转为付费客户");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "转正失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleClearSessions = async (item: ResellerCustomer) => {
    setItemPending(item.id, true);
    try {
      const data = await clearResellerCustomerSessions(item.id);
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      toast.success("已清空在线会话");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空在线会话失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <KeyRound className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">客户管理</h2>
                <p className="text-sm text-stone-500">创建和管理您的客户账号，支持试用和付费两种类型。</p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" />
              创建客户
            </Button>
          </div>

          {revealedKey ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="font-medium">新客户密钥仅展示一次，请立即保存：</div>
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white/80 p-3 md:flex-row md:items-center md:justify-between">
                <code className="break-all font-mono text-[13px]">{revealedKey}</code>
                <Button type="button" variant="outline" className="h-9 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700" onClick={() => void handleCopy(revealedKey)}>
                  <Copy className="size-4" />
                  复制
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              暂无客户。点击右上角按钮创建第一个客户。
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const isPending = pendingIds.has(item.id);
                const activeSessions = Math.max(0, Number(item.active_sessions) || 0);
                const displayKey = String(item.display_key || "").trim();
                return (
                  <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-stone-800">{item.name}</div>
                        <Badge variant={item.is_trial ? "info" : "success"} className="rounded-md">
                          {item.is_trial ? "试用" : "付费"}
                        </Badge>
                        <Badge variant={item.enabled ? "success" : "secondary"} className="rounded-md">
                          {item.enabled ? "已启用" : "已禁用"}
                        </Badge>
                      </div>
                      <div className="flex max-w-3xl flex-col gap-2 rounded-lg bg-stone-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <code className={`break-all font-mono text-[12px] ${displayKey ? "text-stone-700" : "text-stone-400"}`}>
                          {displayKey || "原始密钥未保存"}
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 shrink-0 rounded-lg border-stone-200 bg-white px-3 text-stone-700"
                          onClick={() => void handleCopy(displayKey)}
                          disabled={!displayKey}
                        >
                          <Copy className="size-3.5" />
                          复制
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                        {!item.is_trial && <span>套餐 {tierLabel(item.tier)}</span>}
                        <span>本月用量 {item.monthly_usage} / {item.monthly_limit === -1 ? "不限" : item.monthly_limit}</span>
                        <span>剩余 {formatRemainingDays(item.remaining_days)}</span>
                        <span>到期 {formatDateTime(item.expires_at)}</span>
                        <span>在线数 {activeSessions} / {Math.max(1, Number(item.max_sessions) || 4)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-amber-200 bg-white px-4 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                        onClick={() => void handleClearSessions(item)}
                        disabled={isPending || activeSessions === 0}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                        一键清空在线
                      </Button>
                      {item.is_trial && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-xl border-violet-200 bg-white px-4 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
                          onClick={() => {
                            setConvertingItem(item);
                            setConvertTier("200");
                            setConvertValidDays("30");
                          }}
                          disabled={isPending}
                        >
                          {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                          转正
                        </Button>
                      )}
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => openEditDialog(item)} disabled={isPending}>
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                        编辑
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => void handleToggle(item)} disabled={isPending}>
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : item.enabled ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                        {item.enabled ? "禁用" : "启用"}
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => { setRenewingItem(item); setRenewDays("30"); }} disabled={isPending}>
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                        续期
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>创建客户</DialogTitle>
            <DialogDescription className="text-sm leading-6">填写客户信息，创建后会生成一条密钥。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称</label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="例如：客户 A" className="h-11 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="create-is-trial" checked={createIsTrial} onChange={(e) => setCreateIsTrial(e.target.checked)} className="size-4 rounded border-stone-300" />
              <label htmlFor="create-is-trial" className="text-sm font-medium text-stone-700">试用账号</label>
              <span className="text-xs text-stone-500">（试用：1 天有效期，10 次限额）</span>
            </div>
            {!createIsTrial && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700">套餐</label>
                  <Select
                    value={createTier}
                    onValueChange={(value) => {
                      setCreateTier(value);
                      if (!canEditValidDays(value)) {
                        setCreateValidDays(String(FIXED_TIER_VALID_DAYS));
                      }
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIER_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700">有效期（天）</label>
                  <Input
                    value={canEditValidDays(createTier) ? createValidDays : String(FIXED_TIER_VALID_DAYS)}
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    onChange={(e) => setCreateValidDays(e.target.value)}
                    placeholder="30"
                    disabled={!canEditValidDays(createTier)}
                    className="h-11 rounded-xl border-stone-200 bg-white disabled:bg-stone-100 disabled:text-stone-500"
                  />
                  {!canEditValidDays(createTier) && (
                    <p className="text-xs text-stone-500">有限套餐固定 30 天，便于管理员按套餐收款。</p>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">同时在线数</label>
              <Input value={createMaxSessions} type="number" min="1" max="100" step="1" onChange={(e) => setCreateMaxSessions(e.target.value)} placeholder="4" className="h-11 rounded-xl border-stone-200 bg-white" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>取消</Button>
            <Button type="button" className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleCreate()} disabled={isCreating}>
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑客户</DialogTitle>
            <DialogDescription className="text-sm leading-6">修改客户名称、套餐和同时在线数。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-11 rounded-xl border-stone-200 bg-white" />
            </div>
            {editingItem && !editingItem.is_trial && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">套餐</label>
                <Select value={editTier} onValueChange={setEditTier}>
                  <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIER_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">同时在线数</label>
              <Input value={editMaxSessions} type="number" min="1" max="100" step="1" onChange={(e) => setEditMaxSessions(e.target.value)} className="h-11 rounded-xl border-stone-200 bg-white" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setEditingItem(null)} disabled={editingItem ? pendingIds.has(editingItem.id) : false}>取消</Button>
            <Button type="button" className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleEdit()} disabled={editingItem ? pendingIds.has(editingItem.id) : false}>
              {editingItem && pendingIds.has(editingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew dialog */}
      <Dialog open={Boolean(renewingItem)} onOpenChange={(open) => { if (!open) setRenewingItem(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>续期客户</DialogTitle>
            <DialogDescription className="text-sm leading-6">续期会在当前过期时间基础上顺延；如果已过期，则从现在开始重新计算。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">续期天数</label>
            <Input value={renewDays} type="number" min="1" max="3650" step="1" onChange={(e) => setRenewDays(e.target.value)} placeholder="30" className="h-11 rounded-xl border-stone-200 bg-white" />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setRenewingItem(null)} disabled={renewingItem ? pendingIds.has(renewingItem.id) : false}>取消</Button>
            <Button type="button" className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleRenew()} disabled={renewingItem ? pendingIds.has(renewingItem.id) : false}>
              {renewingItem && pendingIds.has(renewingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              续期
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert trial dialog */}
      <Dialog open={Boolean(convertingItem)} onOpenChange={(open) => { if (!open) setConvertingItem(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>试用转正</DialogTitle>
            <DialogDescription className="text-sm leading-6">将试用客户「{convertingItem?.name}」转为付费客户，选择套餐和有效期。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">套餐</label>
              <Select
                value={convertTier}
                onValueChange={(value) => {
                  setConvertTier(value);
                  if (!canEditValidDays(value)) {
                    setConvertValidDays(String(FIXED_TIER_VALID_DAYS));
                  }
                }}
              >
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">有效期（天）</label>
              <Input
                value={canEditValidDays(convertTier) ? convertValidDays : String(FIXED_TIER_VALID_DAYS)}
                type="number"
                min="1"
                max="3650"
                step="1"
                onChange={(e) => setConvertValidDays(e.target.value)}
                placeholder="30"
                disabled={!canEditValidDays(convertTier)}
                className="h-11 rounded-xl border-stone-200 bg-white disabled:bg-stone-100 disabled:text-stone-500"
              />
              {!canEditValidDays(convertTier) && (
                <p className="text-xs text-stone-500">有限套餐固定 30 天，便于管理员按套餐收款。</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setConvertingItem(null)} disabled={convertingItem ? pendingIds.has(convertingItem.id) : false}>取消</Button>
            <Button type="button" className="h-10 rounded-xl bg-violet-600 px-5 text-white hover:bg-violet-700" onClick={() => void handleConvert()} disabled={convertingItem ? pendingIds.has(convertingItem.id) : false}>
              {convertingItem && pendingIds.has(convertingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              确认转正
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
