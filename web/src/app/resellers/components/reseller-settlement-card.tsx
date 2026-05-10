"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, LoaderCircle, Plus, RefreshCw } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createSettlement,
  fetchResellers,
  fetchSettlements,
  type ResellerKey,
  type Settlement,
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

export function ResellerSettlementCard() {
  const didLoadRef = useRef(false);
  const [resellers, setResellers] = useState<ResellerKey[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [items, setItems] = useState<Settlement[]>([]);
  const [isLoadingResellers, setIsLoadingResellers] = useState(true);
  const [isLoadingSettlements, setIsLoadingSettlements] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const [customerCount, setCustomerCount] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadResellers();
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadSettlements(selectedId);
    } else {
      setItems([]);
    }
  }, [selectedId]);

  const handleCreate = async () => {
    if (!selectedId) return;
    setIsCreating(true);
    try {
      const data = await createSettlement(selectedId, {
        period: period.trim(),
        customer_count: Math.max(0, Math.floor(Number(customerCount) || 0)),
        amount: Math.max(0, Number(amount) || 0),
        status,
        notes: notes.trim(),
      });
      setItems(data.items);
      setIsDialogOpen(false);
      setPeriod("");
      setCustomerCount("");
      setAmount("");
      setStatus("unpaid");
      setNotes("");
      toast.success("结算记录已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建结算记录失败");
    } finally {
      setIsCreating(false);
    }
  };

  const selectedReseller = resellers.find((r) => r.id === selectedId);

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
                <p className="text-sm text-stone-500">查看并记录代理商的结算信息。</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-9 w-56 rounded-xl border-stone-200 bg-white text-sm">
                  <SelectValue placeholder="选择代理商" />
                </SelectTrigger>
                <SelectContent>
                  {resellers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                onClick={() => {
                  if (selectedId) void loadSettlements(selectedId);
                }}
                disabled={isLoadingSettlements || !selectedId}
              >
                {isLoadingSettlements ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </Button>
              <Button
                className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
                onClick={() => setIsDialogOpen(true)}
                disabled={!selectedId}
              >
                <Plus className="size-4" />
                新增结算
              </Button>
            </div>
          </div>

          {selectedReseller && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span>客户总数 {Number(selectedReseller.total_customers) || 0}</span>
              <span>活跃客户 {Number(selectedReseller.active_customers) || 0}</span>
              <span>付费客户 {Number(selectedReseller.paid_customers) || 0}</span>
              <span>试用客户 {Number(selectedReseller.trial_customers) || 0}</span>
              <span>单价 {Number(selectedReseller.cost_per_user) || 0}</span>
            </div>
          )}

          {!selectedId ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              请先在上方选择一个代理商。
            </div>
          ) : isLoadingSettlements ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              暂无结算记录。点击右上角按钮即可新增。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>账期</TableHead>
                    <TableHead>客户数</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>结算时间</TableHead>
                    <TableHead>备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap font-medium text-stone-800">{item.period || "—"}</TableCell>
                      <TableCell>{item.customer_count}</TableCell>
                      <TableCell>{item.amount}</TableCell>
                      <TableCell>
                        <Badge variant={item.status === "paid" ? "success" : "warning"} className="rounded-md">
                          {item.status === "paid" ? "已结算" : "未结算"}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(item.settled_at)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-stone-500">{item.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add settlement dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>新增结算记录</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为「{selectedReseller?.name}」新增一条结算记录。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">账期</label>
              <Input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="例如：2026-05"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">客户数</label>
              <Input
                value={customerCount}
                type="number"
                min="0"
                step="1"
                onChange={(e) => setCustomerCount(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">金额</label>
              <Input
                value={amount}
                type="number"
                min="0"
                step="0.01"
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">状态</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">未结算</SelectItem>
                  <SelectItem value="paid">已结算</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">备注</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="可选填写备注信息"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
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
    </>
  );
}
