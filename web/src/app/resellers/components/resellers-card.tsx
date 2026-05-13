"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Copy, KeyRound, LoaderCircle, Pencil, Plus, Trash2, WifiOff } from "lucide-react";
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
import {
  clearResellerSessions,
  createResellerKey,
  deleteResellerKey,
  fetchResellers,
  updateResellerKey,
  type ResellerKey,
} from "@/lib/api";

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRemainingDays(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${Math.max(0, Math.floor(parsed))} 天`;
}

export function ResellersCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<ResellerKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [validDays, setValidDays] = useState("365");
  const [maxSessions, setMaxSessions] = useState("4");
  const [maxTrialKeys, setMaxTrialKeys] = useState("20");
  const [costPerUser, setCostPerUser] = useState("0");
  const [isCreating, setIsCreating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [revealedKey, setRevealedKey] = useState("");
  const [deletingItem, setDeletingItem] = useState<ResellerKey | null>(null);
  const [editingItem, setEditingItem] = useState<ResellerKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxTrialKeys, setEditMaxTrialKeys] = useState("20");
  const [editCostPerUser, setEditCostPerUser] = useState("0");
  const [renewingItem, setRenewingItem] = useState<ResellerKey | null>(null);
  const [renewDays, setRenewDays] = useState("30");

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchResellers();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载代理商密钥失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void load();
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const days = Math.max(1, Math.floor(Number(validDays) || 365));
      const sessions = Math.max(1, Math.floor(Number(maxSessions) || 4));
      const trialKeys = Math.max(0, Math.floor(Number(maxTrialKeys) || 20));
      const cost = Math.max(0, Number(costPerUser) || 0);
      const data = await createResellerKey(name.trim(), days, sessions, trialKeys, cost);
      setItems(data.items);
      setRevealedKey(data.key);
      setName("");
      setValidDays("365");
      setMaxSessions("4");
      setMaxTrialKeys("20");
      setCostPerUser("0");
      setIsDialogOpen(false);
      toast.success("代理商密钥已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建代理商密钥失败");
    } finally {
      setIsCreating(false);
    }
  };

  const setItemPending = (id: string, isPending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleToggle = async (item: ResellerKey) => {
    setItemPending(item.id, true);
    try {
      const data = await updateResellerKey(item.id, { enabled: !item.enabled });
      setItems(data.items);
      toast.success(item.enabled ? "代理商密钥已禁用" : "代理商密钥已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新代理商密钥失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleClearSessions = async (item: ResellerKey) => {
    setItemPending(item.id, true);
    try {
      const data = await clearResellerSessions(item.id);
      setItems((current) => current.map((r) => (r.id === item.id ? data.item : r)));
      toast.success("已清空该代理商所有在线会话");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空在线会话失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    const item = deletingItem;
    setItemPending(item.id, true);
    try {
      const data = await deleteResellerKey(item.id);
      setItems(data.items);
      setDeletingItem(null);
      toast.success("代理商密钥已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除代理商密钥失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const openEditDialog = (item: ResellerKey) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditMaxTrialKeys(String(Math.max(0, Number(item.max_trial_keys) || 20)));
    setEditCostPerUser(String(Number(item.cost_per_user) || 0));
  };

  const handleEdit = async () => {
    if (!editingItem) return;
    const item = editingItem;
    const trimmedName = editName.trim();
    const normalizedTrialKeys = Math.max(0, Math.floor(Number(editMaxTrialKeys) || 20));
    const normalizedCost = Math.max(0, Number(editCostPerUser) || 0);
    if (
      trimmedName === item.name &&
      normalizedTrialKeys === (Number(item.max_trial_keys) || 20) &&
      normalizedCost === (Number(item.cost_per_user) || 0)
    ) {
      setEditingItem(null);
      return;
    }
    setItemPending(item.id, true);
    try {
      const data = await updateResellerKey(item.id, {
        ...(trimmedName !== item.name ? { name: trimmedName } : {}),
        ...(normalizedTrialKeys !== (Number(item.max_trial_keys) || 20) ? { max_trial_keys: normalizedTrialKeys } : {}),
        ...(normalizedCost !== (Number(item.cost_per_user) || 0) ? { cost_per_user: normalizedCost } : {}),
      });
      setItems(data.items);
      setEditingItem(null);
      toast.success("代理商配置已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新代理商密钥失败");
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
      const data = await updateResellerKey(item.id, { renew_days: days });
      setItems(data.items);
      setRenewingItem(null);
      toast.success("已续期");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "续期失败");
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
                <h2 className="text-lg font-semibold tracking-tight">代理商密钥管理</h2>
                <p className="text-sm text-stone-500">为代理商创建专用密钥；代理商可管理自己的客户子账号。</p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setIsDialogOpen(true)}>
              <Plus className="size-4" />
              创建代理商密钥
            </Button>
          </div>

          {revealedKey ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="font-medium">新密钥仅展示一次，请立即保存：</div>
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white/80 p-3 md:flex-row md:items-center md:justify-between">
                <code className="break-all font-mono text-[13px]">{revealedKey}</code>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700"
                  onClick={() => void handleCopy(revealedKey)}
                >
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
              暂无代理商密钥。点击右上角按钮后即可创建并分发给代理商。
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const isPending = pendingIds.has(item.id);
                const displayKey = String(item.display_key || "").trim();
                return (
                  <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-stone-800">{item.name}</div>
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
                        <span>试用额度 {Number(item.trial_customers) || 0} / {Number(item.max_trial_keys) || 0}</span>
                        <span>单价 {Number(item.cost_per_user) || 0}</span>
                        <span>客户数 {Number(item.total_customers) || 0}</span>
                        <span>在线 {Number(item.active_sessions) || 0}</span>
                        <span>剩余 {formatRemainingDays(item.remaining_days)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                        onClick={() => openEditDialog(item)}
                        disabled={isPending}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                        onClick={() => void handleToggle(item)}
                        disabled={isPending}
                      >
                        {isPending ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : item.enabled ? (
                          <Ban className="size-4" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        {item.enabled ? "禁用" : "启用"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                        onClick={() => void handleClearSessions(item)}
                        disabled={isPending || (Number(item.active_sessions) || 0) === 0}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <WifiOff className="size-4" />}
                        清空在线
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                        onClick={() => {
                          setRenewingItem(item);
                          setRenewDays("30");
                        }}
                        disabled={isPending}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                        续期
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-rose-200 bg-white px-4 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => setDeletingItem(item)}
                        disabled={isPending}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        删除
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
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>创建代理商密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              填写代理商信息，创建后会生成一条只能查看一次的原始密钥。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称（可选）</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：代理商 A"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">有效期（天）</label>
              <Input
                value={validDays}
                type="number"
                min="1"
                max="3650"
                step="1"
                onChange={(e) => setValidDays(e.target.value)}
                placeholder="365"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
              <p className="text-xs leading-5 text-stone-500">默认 365 天。到期后会自动禁用。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">同时在线数</label>
              <Input
                value={maxSessions}
                type="number"
                min="1"
                max="100"
                step="1"
                onChange={(e) => setMaxSessions(e.target.value)}
                placeholder="4"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
              <p className="text-xs leading-5 text-stone-500">默认 4 个。超过后新设备登录会被拒绝。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">最大试用子账号数</label>
              <Input
                value={maxTrialKeys}
                type="number"
                min="0"
                step="1"
                onChange={(e) => setMaxTrialKeys(e.target.value)}
                placeholder="20"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
              <p className="text-xs leading-5 text-stone-500">默认 20 个。设为 0 表示不允许创建试用账号。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">每个客户单价</label>
              <Input
                value={costPerUser}
                type="number"
                min="0"
                step="0.01"
                onChange={(e) => setCostPerUser(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
              <p className="text-xs leading-5 text-stone-500">用于结算时计算费用，默认 0。</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={Boolean(deletingItem)} onOpenChange={(open) => (!open ? setDeletingItem(null) : null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>删除代理商密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认删除代理商密钥「{deletingItem?.name}」吗？删除后该密钥及其下属客户将无法继续使用。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setDeletingItem(null)}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-rose-600 px-5 text-white hover:bg-rose-700"
              onClick={() => void handleDelete()}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              {deletingItem && pendingIds.has(deletingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingItem(null);
            setEditMaxTrialKeys("20");
            setEditCostPerUser("0");
          }
        }}
      >
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑代理商密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              修改代理商名称、试用额度和单价。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="例如：代理商 A"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">最大试用子账号数</label>
              <Input
                value={editMaxTrialKeys}
                type="number"
                min="0"
                step="1"
                onChange={(e) => setEditMaxTrialKeys(e.target.value)}
                placeholder="20"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">每个客户单价</label>
              <Input
                value={editCostPerUser}
                type="number"
                min="0"
                step="0.01"
                onChange={(e) => setEditCostPerUser(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => {
                setEditingItem(null);
                setEditMaxTrialKeys("20");
                setEditCostPerUser("0");
              }}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleEdit()}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              {editingItem && pendingIds.has(editingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew dialog */}
      <Dialog open={Boolean(renewingItem)} onOpenChange={(open) => (!open ? setRenewingItem(null) : null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>续期代理商密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              续期会在当前过期时间基础上顺延；如果已过期，则从现在开始重新计算。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">续期天数</label>
            <Input
              value={renewDays}
              type="number"
              min="1"
              max="3650"
              step="1"
              onChange={(e) => setRenewDays(e.target.value)}
              placeholder="30"
              className="h-11 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setRenewingItem(null)}
              disabled={renewingItem ? pendingIds.has(renewingItem.id) : false}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleRenew()}
              disabled={renewingItem ? pendingIds.has(renewingItem.id) : false}
            >
              {renewingItem && pendingIds.has(renewingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              续期
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
