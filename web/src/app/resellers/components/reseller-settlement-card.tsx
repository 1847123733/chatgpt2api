"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, RefreshCw, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createSettlement,
  fetchResellers,
  fetchSettlements,
  previewSettlement,
  type ResellerKey,
  type Settlement,
  type SettlementCategory,
  type SettlementPreview,
  type SettlementPreviewItem,
} from "@/lib/api";

const CATEGORY_LABELS: Record<SettlementCategory, string> = {
  package: "套餐账号",
  trial: "试用账号",
  unlimited: "不限制次数",
};

const ACTION_LABELS: Record<string, string> = {
  create: "新增",
  convert: "转正",
  renew: "续期",
};

function defaultPeriod() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
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

function money(value: unknown) {
  const parsed = Number(value) || 0;
  return parsed.toFixed(2);
}

function categoryVariant(category: SettlementCategory) {
  if (category === "trial") return "info";
  if (category === "unlimited") return "warning";
  return "success";
}

function BillLineTable({ items }: { items: SettlementPreviewItem[] }) {
  if (items.length === 0) {
    return <div className="rounded-xl bg-stone-50 px-6 py-8 text-center text-sm text-stone-500">当前账期没有可结算明细。</div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-100">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>客户</TableHead>
            <TableHead>分类</TableHead>
            <TableHead>动作</TableHead>
            <TableHead>数量/天数</TableHead>
            <TableHead>单价</TableHead>
            <TableHead>金额</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(item.occurred_at)}</TableCell>
              <TableCell className="max-w-[180px] truncate font-medium text-stone-800">{item.customer_name || item.customer_id}</TableCell>
              <TableCell>
                <Badge variant={categoryVariant(item.category)} className="rounded-md">
                  {CATEGORY_LABELS[item.category] || item.category}
                </Badge>
              </TableCell>
              <TableCell>{ACTION_LABELS[item.action] || item.action}</TableCell>
              <TableCell>{item.category === "unlimited" ? `${item.quantity} 天` : `${item.quantity} 个`}</TableCell>
              <TableCell>{money(item.unit_price)}</TableCell>
              <TableCell className="font-medium">{money(item.amount)}</TableCell>
              <TableCell>
                <Badge variant={item.settled ? "success" : "secondary"} className="rounded-md">
                  {item.settled ? "已结清" : "未结清"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ResellerSettlementCard() {
  const didLoadRef = useRef(false);
  const [resellers, setResellers] = useState<ResellerKey[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [items, setItems] = useState<Settlement[]>([]);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [isLoadingResellers, setIsLoadingResellers] = useState(true);
  const [isLoadingSettlements, setIsLoadingSettlements] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [period, setPeriod] = useState(defaultPeriod);
  const [trialUnitPrice, setTrialUnitPrice] = useState("1");
  const [unlimitedDailyPrice, setUnlimitedDailyPrice] = useState("2");
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const selectedReseller = useMemo(() => resellers.find((r) => r.id === selectedId), [resellers, selectedId]);

  const loadResellers = async () => {
    setIsLoadingResellers(true);
    try {
      const data = await fetchResellers();
      setResellers(data.items);
      if (data.items.length > 0 && !selectedId) {
        setSelectedId(data.items[0].id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载代理商列表失败");
    } finally {
      setIsLoadingResellers(false);
    }
  };

  const loadSettlements = async (resellerId: string) => {
    if (!resellerId) {
      setItems([]);
      return;
    }
    setIsLoadingSettlements(true);
    try {
      const data = await fetchSettlements(resellerId);
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载结算记录失败");
    } finally {
      setIsLoadingSettlements(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedId) return;
    setIsPreviewing(true);
    try {
      const data = await previewSettlement(selectedId, {
        period: period.trim() || defaultPeriod(),
        trial_unit_price: Math.max(0, Number(trialUnitPrice) || 1),
        unlimited_daily_price: Math.max(0, Number(unlimitedDailyPrice) || 2),
      });
      setPreview(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成结算清单失败");
    } finally {
      setIsPreviewing(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadResellers();
  }, []);

  useEffect(() => {
    if (selectedId) {
      setPreview(null);
      void loadSettlements(selectedId);
    } else {
      setItems([]);
      setPreview(null);
    }
  }, [selectedId]);

  const handleCreate = async () => {
    if (!selectedId) return;
    setIsCreating(true);
    try {
      const data = await createSettlement(selectedId, {
        period: period.trim() || defaultPeriod(),
        status: "paid",
        notes: notes.trim(),
        trial_unit_price: Math.max(0, Number(trialUnitPrice) || 1),
        unlimited_daily_price: Math.max(0, Number(unlimitedDailyPrice) || 2),
      });
      setItems(data.items);
      setPreview(null);
      setIsDialogOpen(false);
      setNotes("");
      toast.success("结算清单已确认结清");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建结算记录失败");
    } finally {
      setIsCreating(false);
    }
  };

  const summary = preview?.summary;
  const previewItems = preview?.items || [];
  const unpaidItems = previewItems.filter((item) => !item.settled);

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <CreditCard className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">结算管理</h2>
                <p className="text-sm text-stone-500">按月生成代理商客户事件清单，并确认是否结清。</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-9 w-56 rounded-xl border-stone-200 bg-white text-sm">
                  <SelectValue placeholder={isLoadingResellers ? "加载中" : "选择代理商"} />
                </SelectTrigger>
                <SelectContent>
                  {resellers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-32 rounded-xl border-stone-200 bg-white" placeholder="2026-05" />
              <Button variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => void loadPreview()} disabled={isPreviewing || !selectedId}>
                {isPreviewing ? <LoaderCircle className="size-4 animate-spin" /> : <ReceiptText className="size-4" />}
                生成清单
              </Button>
              <Button variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => selectedId && void loadSettlements(selectedId)} disabled={isLoadingSettlements || !selectedId}>
                {isLoadingSettlements ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </Button>
            </div>
          </div>

          {selectedReseller && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span>客户总数 {Number(selectedReseller.total_customers) || 0}</span>
              <span>付费客户 {Number(selectedReseller.paid_customers) || 0}</span>
              <span>试用客户 {Number(selectedReseller.trial_customers) || 0}</span>
              <span>套餐单价 {money(selectedReseller.cost_per_user)}</span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">套餐账号</div>
              <div className="mt-2 text-lg font-semibold text-stone-900">{summary?.package.count || 0} 笔 / {money(summary?.package.amount)} 元</div>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">试用账号</div>
              <div className="mt-2 text-lg font-semibold text-stone-900">{summary?.trial.count || 0} 笔 / {money(summary?.trial.amount)} 元</div>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">不限制次数</div>
              <div className="mt-2 text-lg font-semibold text-stone-900">{summary?.unlimited.quantity || 0} 天 / {money(summary?.unlimited.amount)} 元</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-stone-100 bg-white px-4 py-4 md:flex-row md:items-end md:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">试用账号单价</label>
                <Input value={trialUnitPrice} type="number" min="0" step="0.01" onChange={(e) => setTrialUnitPrice(e.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">不限制每天单价</label>
                <Input value={unlimitedDailyPrice} type="number" min="0" step="0.01" onChange={(e) => setUnlimitedDailyPrice(e.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">本期未结金额</label>
                <div className="flex h-10 items-center rounded-xl bg-stone-50 px-3 text-sm font-semibold text-stone-900">{money(preview?.total_amount)} 元</div>
              </div>
            </div>
            <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => setIsDialogOpen(true)} disabled={!preview || preview.unsettled_count === 0}>
              <CheckCircle2 className="size-4" />
              确认结清
            </Button>
          </div>

          <BillLineTable items={previewItems} />

          <div className="space-y-3">
            <div className="text-sm font-medium text-stone-800">历史结算</div>
            {isLoadingSettlements ? (
              <div className="flex items-center justify-center py-8">
                <LoaderCircle className="size-5 animate-spin text-stone-400" />
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-xl bg-stone-50 px-6 py-8 text-center text-sm text-stone-500">暂无历史结算记录。</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-stone-100">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>账期</TableHead>
                      <TableHead>客户数</TableHead>
                      <TableHead>明细数</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>结算时间</TableHead>
                      <TableHead>备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap font-medium text-stone-800">{item.period || "-"}</TableCell>
                        <TableCell>{item.customer_count}</TableCell>
                        <TableCell>{item.event_count ?? item.customer_count}</TableCell>
                        <TableCell>{money(item.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={item.status === "paid" ? "success" : "warning"} className="rounded-md">
                            {item.status === "paid" ? "已结清" : "未结清"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(item.settled_at)}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-stone-500">{item.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>确认结清</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              将「{selectedReseller?.name}」{preview?.period} 的 {unpaidItems.length} 条未结明细标记为已结清。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
              本期金额 <span className="font-semibold text-stone-950">{money(preview?.total_amount)} 元</span>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">备注</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选填写收款备注" className="h-11 rounded-xl border-stone-200 bg-white" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>
              取消
            </Button>
            <Button type="button" className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleCreate()} disabled={isCreating || unpaidItems.length === 0}>
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
