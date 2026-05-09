"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Clock3, ImageIcon, LoaderCircle, RefreshCw, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { ImageLightbox } from "@/components/image-lightbox";
import { ImageThumbnail, getImageThumbnailUrl } from "@/components/image-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchUserKeyUsage, type UserKeyUsageItem, type UserKeyUsageLog, type UserKeyUsageSummary } from "@/lib/api";

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

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${(value / 1000).toFixed(2)} s`;
}

function statusBadgeVariant(status: string) {
  return status === "failed" ? "danger" : "success";
}

function statusLabel(status: string) {
  return status === "failed" ? "失败" : "成功";
}

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

function RecentLogTable({ logs }: { logs: UserKeyUsageLog[] }) {
  if (logs.length === 0) {
    return <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">这个用户还没有调用日志。</div>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>接口</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>耗时</TableHead>
            <TableHead>图片</TableHead>
            <TableHead>简述</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(log.time)}</TableCell>
              <TableCell className="whitespace-nowrap text-stone-500">{log.endpoint || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{log.model || "-"}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(log.status)} className="rounded-md">
                  {statusLabel(log.status)}
                </Badge>
              </TableCell>
              <TableCell>{formatDuration(log.duration_ms)}</TableCell>
              <TableCell>{log.image_count}</TableCell>
              <TableCell className="max-w-[240px] truncate text-stone-500">{log.error || log.summary || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function UserKeyUsageCard() {
  const didLoadRef = useRef(false);
  const [summary, setSummary] = useState<UserKeyUsageSummary>({
    total_calls: 0,
    success_calls: 0,
    failed_calls: 0,
    image_count: 0,
    active_users: 0,
  });
  const [items, setItems] = useState<UserKeyUsageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imageTarget, setImageTarget] = useState<UserKeyUsageItem | null>(null);
  const [logTarget, setLogTarget] = useState<UserKeyUsageItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const lightboxImages = useMemo(
    () => (imageTarget?.recent_images || []).map((url, index) => ({ id: `${imageTarget?.key_id}-${index}`, src: url })),
    [imageTarget],
  );

  const loadUsage = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUserKeyUsage();
      setSummary(data.summary);
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用量统计失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadUsage();
  }, []);

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <BarChart3 className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">用量统计</h2>
                <p className="text-sm text-stone-500">按用户密钥汇总调用、成功率、图片数量和最近记录。</p>
              </div>
            </div>
            <Button variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => void loadUsage()} disabled={isLoading}>
              {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新统计
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricBlock label="总调用" value={summary.total_calls} />
            <MetricBlock label="成功调用" value={summary.success_calls} tone="success" />
            <MetricBlock label="失败调用" value={summary.failed_calls} tone="danger" />
            <MetricBlock label="生成图片" value={summary.image_count} tone="info" />
            <MetricBlock label="活跃用户" value={summary.active_users} />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              暂无用户密钥。创建密钥并产生调用后，这里会显示统计。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>用户密钥</TableHead>
                    <TableHead>调用次数</TableHead>
                    <TableHead>成功 / 失败</TableHead>
                    <TableHead>成功率</TableHead>
                    <TableHead>图片数</TableHead>
                    <TableHead>平均耗时</TableHead>
                    <TableHead>最近调用</TableHead>
                    <TableHead className="w-52">查看</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.key_id}>
                      <TableCell>
                        <div className="font-medium text-stone-800">{item.key_name || item.key_id}</div>
                        <div className="mt-1 font-mono text-xs text-stone-400">{item.key_id}</div>
                      </TableCell>
                      <TableCell className="font-semibold">{item.total_calls}</TableCell>
                      <TableCell>
                        <span className="text-emerald-700">{item.success_calls}</span>
                        <span className="px-1 text-stone-300">/</span>
                        <span className="text-rose-700">{item.failed_calls}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.success_rate >= 90 || item.total_calls === 0 ? "success" : item.success_rate >= 70 ? "warning" : "danger"} className="rounded-md">
                          {item.total_calls ? `${item.success_rate}%` : "-"}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.image_count}</TableCell>
                      <TableCell>{formatDuration(item.average_duration_ms)}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-stone-500">
                          <Clock3 className="size-3.5" />
                          {formatDateTime(item.last_called_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            className="h-8 rounded-lg border-stone-200 bg-white px-3 text-stone-600"
                            onClick={() => setImageTarget(item)}
                            disabled={item.recent_images.length === 0}
                          >
                            <ImageIcon className="size-4" />
                            图片
                          </Button>
                          <Button
                            variant="outline"
                            className="h-8 rounded-lg border-stone-200 bg-white px-3 text-stone-600"
                            onClick={() => setLogTarget(item)}
                            disabled={item.recent_logs.length === 0}
                          >
                            <ScrollText className="size-4" />
                            日志
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(imageTarget)} onOpenChange={(open) => (!open ? setImageTarget(null) : null)}>
        <DialogContent className="flex h-[min(88vh,820px)] w-[min(92vw,900px)] flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b border-stone-100 px-6 py-5">
            <DialogTitle>{imageTarget?.key_name || "用户"} 的最近图片</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6">
            {imageTarget && imageTarget.recent_images.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {imageTarget.recent_images.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    className="aspect-square overflow-hidden rounded-xl border border-stone-200 bg-stone-100"
                    onClick={() => {
                      setLightboxIndex(index);
                      setLightboxOpen(true);
                    }}
                  >
                    <ImageThumbnail src={url} thumbnailSrc={getImageThumbnailUrl(url)} className="h-full w-full" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">这个用户还没有图片记录。</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(logTarget)} onOpenChange={(open) => (!open ? setLogTarget(null) : null)}>
        <DialogContent className="flex h-[min(88vh,760px)] w-[min(94vw,980px)] flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b border-stone-100 px-6 py-5">
            <DialogTitle>{logTarget?.key_name || "用户"} 的最近日志</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6">
            <RecentLogTable logs={logTarget?.recent_logs || []} />
          </div>
        </DialogContent>
      </Dialog>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </>
  );
}
