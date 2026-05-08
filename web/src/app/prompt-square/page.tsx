"use client";

import { ExternalLink, RefreshCw, Search, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchPromptSquare, type PromptSquareItem } from "@/lib/api";
import webConfig from "@/constants/common-env";
import { useAuthGuard } from "@/lib/use-auth-guard";

const allFilter = "全部";
const featuredFilter = "Featured";

function getPromptSquarePreviewSrc(url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("/api/image-proxy?")) {
    return normalized;
  }
  return `${webConfig.apiUrl.replace(/\/$/, "")}/api/image-proxy?url=${encodeURIComponent(normalized)}`;
}

export default function PromptSquarePage() {
  const router = useRouter();
  const { isCheckingAuth, session } = useAuthGuard();
  const [items, setItems] = useState<PromptSquareItem[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(allFilter);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    if (!session) {
      return;
    }

    const load = async (refresh = false) => {
      try {
        if (refresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        const result = await fetchPromptSquare(120, refresh);
        setItems(result.items);
        setRepoUrl(result.source.repo_url);
        setFetchedAt(result.fetched_at);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载 GitHub 提示词失败");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    void load();
  }, [session]);

  const languageFilters = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.language).filter(Boolean))).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      const filterMatched =
        activeFilter === allFilter
          ? true
          : activeFilter === featuredFilter
            ? item.featured
            : item.language === activeFilter;
      if (!filterMatched) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.title,
        item.description,
        item.prompt,
        item.prompt_preview,
        item.author_name,
        item.language,
        ...item.languages,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [activeFilter, items, searchText]);

  const lightboxImages = useMemo(
    () =>
      filteredItems.map((item) => ({
        id: item.id,
        src: getPromptSquarePreviewSrc(item.preview_image_url),
      })),
    [filteredItems],
  );

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500" />
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1380px] pb-8">
      <div className="overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(244,238,230,0.92))] shadow-[0_28px_90px_-42px_rgba(15,23,42,0.35)]">
        <div className="border-b border-stone-200/70 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                <Sparkles className="size-3.5" />
                运行时拉取 GitHub Prompt 广场
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-stone-950 sm:text-4xl">提示词广场</h1>
              <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
                当前内容来自 GitHub 仓库运行时抓取并缓存，页面会展示仓库 README 里的真实示例图和 Prompt，点一下就能带到画图页。
              </p>
            </div>

            <div className="w-full max-w-md">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索标题、分类、标签或 Prompt 关键词"
                  className="h-12 rounded-full border-stone-200 bg-white pl-11 pr-4"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[allFilter, featuredFilter, ...languageFilters].map((filter) => {
              const active = filter === activeFilter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={
                    active
                      ? "rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white"
                      : "rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                  }
                >
                  {filter}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-5 sm:px-8 sm:py-7">
          <div className="mb-5 flex items-center justify-between gap-3 text-sm text-stone-500">
            <span>{isLoading ? "正在加载 GitHub 数据..." : `共 ${filteredItems.length} / ${items.length} 个模板`}</span>
            <div className="flex items-center gap-2">
              {repoUrl ? (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                >
                  GitHub
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900 disabled:opacity-50"
                onClick={async () => {
                  try {
                    setIsRefreshing(true);
                    const result = await fetchPromptSquare(120, true);
                    setItems(result.items);
                    setRepoUrl(result.source.repo_url);
                    setFetchedAt(result.fetched_at);
                    toast.success("已刷新 GitHub Prompt 数据");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "刷新失败");
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
              >
                <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                刷新
              </button>
            </div>
          </div>

          {!isLoading && fetchedAt ? (
            <div className="mb-5 text-xs text-stone-400">
              最近抓取时间：{new Date(fetchedAt).toLocaleString("zh-CN")}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/75 px-6 py-14 text-center">
              <p className="text-lg font-semibold text-stone-900">正在从 GitHub 拉取 Prompt 数据</p>
              <p className="mt-2 text-sm text-stone-500">首次加载会稍慢一点，后端会做缓存。</p>
            </div>
          ) : filteredItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-[28px] border border-stone-200/80 bg-white shadow-[0_20px_70px_-45px_rgba(15,23,42,0.45)]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
                    <button
                      type="button"
                      onClick={() => {
                        const currentIndex = filteredItems.findIndex((candidate) => candidate.id === item.id);
                        if (currentIndex < 0) {
                          return;
                        }
                        setLightboxIndex(currentIndex);
                        setLightboxOpen(true);
                      }}
                      className="block h-full w-full cursor-zoom-in"
                      aria-label={`放大查看 ${item.title}`}
                    >
                      <img
                        src={getPromptSquarePreviewSrc(item.preview_image_url)}
                        alt={item.title}
                        className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]"
                      />
                    </button>
                    <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                        {item.language.toUpperCase()}
                      </span>
                      {item.featured ? (
                        <span className="rounded-full bg-amber-400/95 px-3 py-1 text-xs font-semibold text-stone-950">
                          Featured
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-stone-950">{item.title}</h2>
                        <p className="mt-1 text-xs text-stone-500">
                          No. {item.rank} · {item.author_name || "社区作者"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-stone-600">
                      {item.description || item.prompt_preview}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.raycast_friendly ? (
                        <span
                          key="raycast"
                          className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600"
                        >
                          Raycast Friendly
                        </span>
                      ) : null}
                      {item.languages.map((language) => (
                        <span
                          key={language}
                          className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600"
                        >
                          {language}
                        </span>
                      ))}
                    </div>

                    <div className="mt-5 flex gap-2">
                      <Button
                        className="h-10 flex-1 rounded-full bg-stone-950 text-white hover:bg-stone-800"
                        onClick={() => {
                          const params = new URLSearchParams({
                            prompt: item.prompt,
                            source: "prompt-square",
                          });
                          router.push(`/image?${params.toString()}`);
                        }}
                      >
                        <Wand2 className="size-4" />
                        一键应用
                      </Button>
                      {item.source_url ? (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 px-3 text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                          aria-label="查看来源"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/75 px-6 py-14 text-center">
              <p className="text-lg font-semibold text-stone-900">没有找到匹配的 Prompt</p>
              <p className="mt-2 text-sm text-stone-500">试试更短的关键词，或者切换到其他分类。</p>
            </div>
          )}
        </div>
      </div>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </section>
  );
}
