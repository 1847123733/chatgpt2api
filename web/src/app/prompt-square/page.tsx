"use client";

import { Copy, Edit3, ExternalLink, Heart, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ImageLightbox } from "@/components/image-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createUserPromptSquareItem,
  deleteUserPromptSquareItem,
  fetchPromptSquare,
  fetchUserPromptSquare,
  toggleUserPromptSquareLike,
  type PromptSquareItem,
  type UserPromptSquarePayload,
  updateUserPromptSquareItem,
  uploadUserPromptSquareImage,
} from "@/lib/api";
import webConfig from "@/constants/common-env";
import { useAuthGuard } from "@/lib/use-auth-guard";

const allFilter = "全部";
const featuredFilter = "Featured";
const favoritesFilter = "我的收藏";
const favoritesStorageKey = "chatgpt2api.promptSquare.favorites";
const userPageSize = 24;

type PromptSource = "github" | "user";

const categoryGroupLabels: Record<string, string> = {
  use_cases: "用途",
  style: "风格",
  subjects: "主体",
};

const categoryLabelMap: Record<string, string> = {
  "profile-avatar": "头像 / 形象",
  "social-media-post": "社媒配图",
  "infographic-edu-visual": "信息图 / 教学图",
  "youtube-thumbnail": "视频封面",
  "comic-storyboard": "漫画 / 分镜",
  "product-marketing": "产品营销",
  "ecommerce-main-image": "电商主图",
  "game-asset": "游戏素材",
  "poster-flyer": "海报 / 传单",
  "app-web-design": "应用 / 网页设计",
  photography: "摄影质感",
  "cinematic-film-still": "电影感",
  "anime-manga": "动漫 / 漫画",
  illustration: "插画",
  "sketch-line-art": "草图 / 线稿",
  "comic-graphic-novel": "美漫 / 图像小说",
  "3d-render": "3D 渲染",
  "chibi-q-style": "Q版 / 可爱风",
  isometric: "等距视角",
  "pixel-art": "像素风",
  "oil-painting": "油画",
  watercolor: "水彩",
  "ink-chinese-style": "水墨 / 国风",
  "retro-vintage": "复古",
  "cyberpunk-sci-fi": "赛博朋克 / 科幻",
  minimalism: "极简",
  "portrait-selfie": "人像 / 自拍",
  "influencer-model": "模特 / 达人",
  character: "角色",
  "group-couple": "多人 / 情侣",
  product: "产品",
  "food-drink": "美食 / 饮品",
  "fashion-item": "服饰单品",
  "animal-creature": "动物 / 生物",
  vehicle: "交通工具",
  "architecture-interior": "建筑 / 室内",
  "landscape-nature": "风景 / 自然",
  "cityscape-street": "城市 / 街景",
  "diagram-chart": "图解 / 图表",
  "text-typography": "文字 / 字体",
  "abstract-background": "抽象 / 背景",
};

const languageLabelMap: Record<string, string> = {
  en: "英文",
  ja: "日文",
  zh: "中文",
  cn: "中文",
  ko: "韩文",
  es: "西文",
  fr: "法文",
  de: "德文",
};

const emptyForm: UserPromptSquarePayload = {
  title: "",
  description: "",
  prompt: "",
  preview_image_url: "",
  categories: [],
  language: "zh",
};

function getPromptSquarePreviewSrc(url: string, source: PromptSource) {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return "";
  }
  if (source === "user") {
    return normalized;
  }
  if (normalized.startsWith("/api/image-proxy?")) {
    return normalized;
  }
  return `${webConfig.apiUrl.replace(/\/$/, "")}/api/image-proxy?url=${encodeURIComponent(normalized)}`;
}

function readFavoriteIds() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoritesStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeFavoriteIds(ids: string[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(favoritesStorageKey, JSON.stringify(ids));
  }
}

function getItemCategories(item: PromptSquareItem) {
  return (Array.isArray(item.categories) ? item.categories : []).map((category) => ({
    ...category,
    label: categoryLabelMap[category.slug] || category.label,
  }));
}

function getLanguageLabel(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return languageLabelMap[normalized] || value.toUpperCase();
}

function getCategoryGroupEntries(items: PromptSquareItem[]) {
  const grouped: Record<string, Map<string, string>> = {
    use_cases: new Map(),
    style: new Map(),
    subjects: new Map(),
    custom: new Map(),
  };

  for (const item of items) {
    const categoryGroups = item.category_groups || {};
    for (const group of Object.keys(categoryGroupLabels)) {
      for (const category of categoryGroups[group] || []) {
        grouped[group].set(category.slug, categoryLabelMap[category.slug] || category.label);
      }
    }
    for (const category of getItemCategories(item)) {
      if (!Object.values(grouped).some((values) => values.has(category.slug))) {
        grouped.custom.set(category.slug, category.label);
      }
    }
  }

  return Object.entries(grouped)
    .map(([group, values]) => ({
      group,
      label: categoryGroupLabels[group] || "自定义",
      items: Array.from(values.entries())
        .map(([slug, label]) => ({ slug, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0);
}

function parseCategories(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export default function PromptSquarePage() {
  const router = useRouter();
  const { isCheckingAuth, session } = useAuthGuard();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<PromptSource>("github");
  const [items, setItems] = useState<PromptSquareItem[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(allFilter);
  const [activeCategory, setActiveCategory] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [detailItem, setDetailItem] = useState<PromptSquareItem | null>(null);
  const [editingItem, setEditingItem] = useState<PromptSquareItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<UserPromptSquarePayload>(emptyForm);
  const [categoryText, setCategoryText] = useState("");
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userHasMore, setUserHasMore] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const canManageUserPrompts = session?.role === "admin" || session?.role === "reseller";

  useEffect(() => {
    setFavoriteIds(readFavoriteIds());
  }, []);

  useEffect(() => {
    setActiveFilter(allFilter);
    setActiveCategory("");
    setSearchText("");
    setUserPage(1);
  }, [source]);

  const loadGitHub = async (refresh = false) => {
    const result = await fetchPromptSquare(120, refresh);
    setItems(result.items);
    setRepoUrl(result.source.repo_url);
    setFetchedAt(result.fetched_at);
  };

  const loadUserPrompts = async (page = userPage) => {
    const result = await fetchUserPromptSquare({
      page,
      pageSize: userPageSize,
      category: activeCategory,
      search: searchText,
    });
    setItems(result.items);
    setRepoUrl("");
    setFetchedAt(result.fetched_at);
    setUserTotal(result.total);
    setUserHasMore(result.has_more);
  };

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      try {
        setIsLoading(true);
        if (source === "github") {
          await loadGitHub();
        } else {
          await loadUserPrompts(userPage);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载提示词失败");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [activeCategory, searchText, session, source, userPage]);

  const languageFilters = useMemo(() => {
    if (source === "user") return [];
    return Array.from(new Set(items.map((item) => item.language).filter(Boolean))).sort();
  }, [items, source]);

  const categoryGroups = useMemo(() => getCategoryGroupEntries(items), [items]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const visibleItems = useMemo(() => {
    if (source === "user") return items;
    const keyword = searchText.trim().toLowerCase();
    return items.filter((item) => {
      const filterMatched =
        activeFilter === allFilter
          ? true
          : activeFilter === favoritesFilter
            ? favoriteSet.has(item.id)
            : activeFilter === featuredFilter
              ? item.featured
              : item.language === activeFilter;
      if (!filterMatched) return false;
      if (activeCategory && !getItemCategories(item).some((category) => category.slug === activeCategory)) return false;
      if (!keyword) return true;
      const haystack = [item.title, item.description, item.prompt, item.prompt_preview, item.author_name, item.language, ...item.languages]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [activeCategory, activeFilter, favoriteSet, items, searchText, source]);

  const lightboxImages = useMemo(
    () =>
      visibleItems
        .filter((item) => item.preview_image_url)
        .map((item) => ({
          id: item.id,
          src: getPromptSquarePreviewSrc(item.preview_image_url, source),
        })),
    [source, visibleItems],
  );

  const toggleFavorite = (item: PromptSquareItem) => {
    setFavoriteIds((current) => {
      const exists = current.includes(item.id);
      const next = exists ? current.filter((id) => id !== item.id) : [item.id, ...current];
      writeFavoriteIds(next);
      toast.success(exists ? "已取消收藏" : "已加入收藏夹");
      return next;
    });
  };

  const toggleLike = async (item: PromptSquareItem) => {
    try {
      const result = await toggleUserPromptSquareLike(item.id);
      setItems((current) => current.map((candidate) => (candidate.id === item.id ? result.item : candidate)));
      setDetailItem((current) => (current?.id === item.id ? result.item : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "点赞失败");
    }
  };

  const applyPrompt = (item: PromptSquareItem) => {
    const params = new URLSearchParams({
      prompt: item.prompt,
      source: "prompt-square",
    });
    router.push(`/image?${params.toString()}`);
  };

  const openCreateForm = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setCategoryText("");
    setIsDraggingImage(false);
    setFormOpen(true);
  };

  const openEditForm = (item: PromptSquareItem) => {
    setEditingItem(item);
    setForm({
      title: item.title,
      description: item.description,
      prompt: item.prompt,
      preview_image_url: item.preview_image_url,
      categories: getItemCategories(item).map((category) => category.label),
      language: item.language || "zh",
    });
    setCategoryText(getItemCategories(item).map((category) => category.label).join("，"));
    setIsDraggingImage(false);
    setFormOpen(true);
  };

  const uploadPromptImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    try {
      setIsUploadingImage(true);
      const result = await uploadUserPromptSquareImage(file);
      setForm((current) => ({ ...current, preview_image_url: result.url }));
      toast.success("图片已上传");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setIsUploadingImage(false);
      setIsDraggingImage(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const submitForm = async () => {
    const payload = {
      ...form,
      categories: parseCategories(categoryText),
      language: form.language || "zh",
    };
    if (!payload.preview_image_url) {
      toast.error("请先上传图片示例");
      return;
    }
    try {
      if (editingItem) {
        const result = await updateUserPromptSquareItem(editingItem.id, payload);
        setItems((current) => current.map((item) => (item.id === editingItem.id ? result.item : item)));
        toast.success("Prompt 已更新");
      } else {
        const result = await createUserPromptSquareItem(payload);
        setSource("user");
        setSearchText("");
        setActiveCategory("");
        setUserPage(1);
        setItems((current) => (source === "user" ? [result.item, ...current] : [result.item]));
        setUserTotal((current) => current + 1);
        toast.success("Prompt 已上传");
      }
      setFormOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const deleteItem = async (item: PromptSquareItem) => {
    if (!window.confirm(`确定删除「${item.title}」吗？`)) return;
    try {
      await deleteUserPromptSquareItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setDetailItem(null);
      toast.success("Prompt 已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500" />
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1380px] pb-8">
      <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.35)]">
        <div className="border-b border-stone-200/70 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                <Sparkles className="size-3.5" />
                {source === "github" ? "运行时拉取 GitHub Prompt 广场" : "用户上传 Prompt 广场"}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-stone-950 sm:text-4xl">提示词广场</h1>
              <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
                GitHub Prompt 广场保留仓库示例；用户 Prompt 广场支持所有人上传、点赞排序、分类筛选和分页浏览。
              </p>
            </div>

            <div className="w-full max-w-md space-y-3">
              <div className="grid grid-cols-2 rounded-2xl border border-stone-200 bg-stone-50 p-1">
                {[
                  ["github", "GitHub Prompt"],
                  ["user", "用户 Prompt"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSource(value as PromptSource)}
                    className={`h-10 rounded-xl text-sm font-medium transition ${source === value ? "bg-stone-950 text-white" : "text-stone-600 hover:text-stone-950"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={searchText}
                  onChange={(event) => {
                    setSearchText(event.target.value);
                    setUserPage(1);
                  }}
                  placeholder="搜索标题、分类、作者或 Prompt"
                  className="h-12 rounded-2xl border-stone-200 bg-white pl-11 pr-4"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {source === "github"
              ? [allFilter, featuredFilter, favoritesFilter, ...languageFilters].map((filter) => {
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
                      {filter === favoritesFilter ? <Heart className="mr-1 inline size-3.5" /> : null}
                      {filter === featuredFilter ? "精选" : languageFilters.includes(filter) ? getLanguageLabel(filter) : filter}
                    </button>
                  );
                })
              : null}
            {source === "user" ? (
              <Button className="h-10 rounded-full bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={openCreateForm}>
                <Plus className="size-4" />
                上传 Prompt
              </Button>
            ) : null}
          </div>

          {categoryGroups.length > 0 ? (
            <div className="mt-5 space-y-3 border-t border-stone-200/70 pt-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span className="font-medium text-stone-600">分类标签</span>
                {activeCategory ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 font-medium text-stone-600 hover:bg-stone-200"
                    onClick={() => {
                      setActiveCategory("");
                      setUserPage(1);
                    }}
                  >
                    清除分类
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {categoryGroups.map((group) => (
                  <div key={group.group} className="flex flex-wrap items-center gap-2">
                    <span className="w-10 shrink-0 text-xs font-medium text-stone-400">{group.label}</span>
                    {group.items.map((category) => {
                      const active = category.slug === activeCategory;
                      return (
                        <button
                          key={category.slug}
                          type="button"
                          onClick={() => {
                            setActiveCategory(active ? "" : category.slug);
                            setUserPage(1);
                          }}
                        >
                          <Badge
                            variant={active ? "default" : "outline"}
                            className={`cursor-pointer rounded-md ${active ? "bg-stone-950 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
                          >
                            {category.label}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-5 sm:px-8 sm:py-7">
          <div className="mb-5 flex items-center justify-between gap-3 text-sm text-stone-500">
            <span>
              {isLoading
                ? "正在加载数据..."
                : source === "user"
                  ? `共 ${userTotal} 个用户 Prompt`
                  : `共 ${visibleItems.length} / ${items.length} 个模板`}
            </span>
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
                    if (source === "github") {
                      await loadGitHub(true);
                      toast.success("已刷新 GitHub Prompt 数据");
                    } else {
                      await loadUserPrompts(userPage);
                      toast.success("已刷新用户 Prompt 数据");
                    }
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

          {!isLoading && fetchedAt ? <div className="mb-5 text-xs text-stone-400">最近更新时间：{new Date(fetchedAt).toLocaleString("zh-CN")}</div> : null}

          {isLoading ? (
            <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50 px-6 py-14 text-center">
              <p className="text-lg font-semibold text-stone-900">正在加载 Prompt 数据</p>
              <p className="mt-2 text-sm text-stone-500">首次加载会稍慢一点。</p>
            </div>
          ) : visibleItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleItems.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-[24px] border border-stone-200/80 bg-white shadow-[0_20px_70px_-45px_rgba(15,23,42,0.45)]">
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
                    {item.preview_image_url ? (
                      <button
                        type="button"
                        onClick={() => {
                          const currentIndex = lightboxImages.findIndex((candidate) => candidate.id === item.id);
                          if (currentIndex >= 0) {
                            setLightboxIndex(currentIndex);
                            setLightboxOpen(true);
                          }
                        }}
                        className="block h-full w-full cursor-zoom-in"
                        aria-label={`放大查看 ${item.title}`}
                      >
                        <img
                          src={getPromptSquarePreviewSrc(item.preview_image_url, source)}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]"
                        />
                      </button>
                    ) : (
                      <div className="flex h-full items-center justify-center bg-stone-100 px-8 text-center text-sm text-stone-400">暂无示例图</div>
                    )}
                    <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">{getLanguageLabel(item.language)}</span>
                      {source === "user" ? (
                        <span className="rounded-full bg-rose-500/90 px-3 py-1 text-xs font-semibold text-white">{item.like_count || 0} 赞</span>
                      ) : item.featured ? (
                        <span className="rounded-full bg-amber-400/95 px-3 py-1 text-xs font-semibold text-stone-950">精选</span>
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
                      <button
                        type="button"
                        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition ${
                          source === "user"
                            ? item.liked_by_me
                              ? "border-rose-200 bg-rose-50 text-rose-600"
                              : "border-stone-200 bg-white text-stone-400 hover:text-rose-600"
                            : favoriteSet.has(item.id)
                              ? "border-rose-200 bg-rose-50 text-rose-600"
                              : "border-stone-200 bg-white text-stone-400 hover:text-rose-600"
                        }`}
                        onClick={() => (source === "user" ? toggleLike(item) : toggleFavorite(item))}
                        aria-label={source === "user" ? "点赞 Prompt" : "收藏 Prompt"}
                      >
                        <Heart className={`size-4 ${source === "user" ? (item.liked_by_me ? "fill-current" : "") : favoriteSet.has(item.id) ? "fill-current" : ""}`} />
                      </button>
                    </div>

                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-stone-600">{item.description || item.prompt_preview}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {getItemCategories(item).slice(0, 4).map((category) => (
                        <button
                          key={category.slug}
                          type="button"
                          onClick={() => {
                            setActiveCategory(category.slug);
                            setUserPage(1);
                          }}
                        >
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">{category.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button className="h-10 flex-1 rounded-full bg-stone-950 text-white hover:bg-stone-800" onClick={() => applyPrompt(item)}>
                        <Wand2 className="size-4" />
                        一键应用
                      </Button>
                      <Button type="button" variant="outline" className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-600 hover:bg-stone-50" onClick={() => setDetailItem(item)}>
                        详情
                      </Button>
                      {source === "user" && canManageUserPrompts ? (
                        <>
                          <Button type="button" variant="outline" className="h-10 rounded-full border-stone-200 bg-white px-3 text-stone-600" onClick={() => openEditForm(item)}>
                            <Edit3 className="size-4" />
                          </Button>
                          <Button type="button" variant="outline" className="h-10 rounded-full border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50" onClick={() => deleteItem(item)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : item.source_url ? (
                        <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 px-3 text-stone-600 transition hover:border-stone-300 hover:text-stone-900" aria-label="查看来源">
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50 px-6 py-14 text-center">
              <p className="text-lg font-semibold text-stone-900">没有找到匹配的 Prompt</p>
              <p className="mt-2 text-sm text-stone-500">{source === "user" ? "上传第一个用户 Prompt，或者换个搜索词。" : "试试更短的关键词，或者切换到其他分类。"}</p>
            </div>
          )}

          {source === "user" && !isLoading && userTotal > userPageSize ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" className="rounded-full border-stone-200 bg-white" disabled={userPage <= 1} onClick={() => setUserPage((page) => Math.max(1, page - 1))}>
                上一页
              </Button>
              <span className="text-sm text-stone-500">第 {userPage} 页</span>
              <Button variant="outline" className="rounded-full border-stone-200 bg-white" disabled={!userHasMore} onClick={() => setUserPage((page) => page + 1)}>
                下一页
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <ImageLightbox images={lightboxImages} currentIndex={lightboxIndex} open={lightboxOpen} onOpenChange={setLightboxOpen} onIndexChange={setLightboxIndex} />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] w-[min(94vw,760px)] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? "管理用户 Prompt" : "上传用户 Prompt"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-stone-700">标题</label>
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="rounded-2xl border-stone-200" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-stone-700">图片示例</label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => uploadPromptImage(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDraggingImage(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingImage(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDraggingImage(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadPromptImage(event.dataTransfer.files?.[0]);
                }}
                className={`min-h-48 overflow-hidden rounded-2xl border border-dashed text-left transition ${
                  isDraggingImage ? "border-stone-950 bg-stone-100" : "border-stone-300 bg-stone-50 hover:border-stone-400"
                }`}
                disabled={isUploadingImage}
              >
                {form.preview_image_url ? (
                  <div className="relative aspect-[16/9] w-full bg-stone-100">
                    <img
                      src={form.preview_image_url}
                      alt="图片示例预览"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-4 py-3 text-sm text-white backdrop-blur-sm">
                      <span>{isUploadingImage ? "上传中..." : "点击或拖动图片到这里更换"}</span>
                      <span className="font-medium">更换</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-white text-stone-500 shadow-sm">
                      <Upload className={`size-5 ${isUploadingImage ? "animate-pulse" : ""}`} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{isUploadingImage ? "图片上传中..." : "点击选择图片，或拖动图片到这里"}</div>
                      <div className="mt-1 text-xs text-stone-500">支持 JPG、PNG、WEBP、GIF，最大 8MB</div>
                    </div>
                  </div>
                )}
              </button>
              {form.preview_image_url ? (
                <button
                  type="button"
                  className="w-fit text-xs font-medium text-stone-500 hover:text-rose-600"
                  onClick={() => setForm((current) => ({ ...current, preview_image_url: "" }))}
                >
                  移除图片
                </button>
              ) : null}
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-stone-700">分类</label>
              <Input value={categoryText} onChange={(event) => setCategoryText(event.target.value)} className="rounded-2xl border-stone-200" placeholder="人像，摄影质感，产品营销" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-stone-700">描述</label>
              <Textarea value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-24 rounded-2xl border-stone-200" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-stone-700">Prompt</label>
              <Textarea value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} className="min-h-48 rounded-2xl border-stone-200 font-mono text-xs leading-6" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-xl border-stone-200 bg-white" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button className="rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={submitForm}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailItem)} onOpenChange={(open) => (!open ? setDetailItem(null) : null)}>
        <DialogContent className="flex h-[min(90vh,860px)] w-[min(94vw,980px)] flex-col overflow-hidden rounded-3xl p-0">
          <DialogHeader className="shrink-0 border-b border-stone-100 px-6 py-5">
            <DialogTitle className="pr-8 text-xl">{detailItem?.title}</DialogTitle>
          </DialogHeader>
          {detailItem ? (
            <div className="grid flex-1 overflow-hidden lg:grid-cols-[360px_1fr]">
              <div className="overflow-y-auto border-b border-stone-100 bg-stone-50/70 p-5 lg:border-r lg:border-b-0">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-stone-100">
                  {detailItem.preview_image_url ? <img src={getPromptSquarePreviewSrc(detailItem.preview_image_url, source)} alt={detailItem.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {source === "user" ? <Badge variant="danger" className="rounded-md">{detailItem.like_count || 0} 赞</Badge> : null}
                  {detailItem.featured ? <Badge variant="warning" className="rounded-md">精选</Badge> : null}
                  {detailItem.languages.map((language) => (
                    <Badge key={language} variant="secondary" className="rounded-md">{getLanguageLabel(language)}</Badge>
                  ))}
                </div>
                {getItemCategories(detailItem).length > 0 ? (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-medium text-stone-400">分类</div>
                    <div className="flex flex-wrap gap-2">
                      {getItemCategories(detailItem).map((category) => (
                        <button
                          key={category.slug}
                          type="button"
                          onClick={() => {
                            setActiveCategory(category.slug);
                            setUserPage(1);
                            setDetailItem(null);
                          }}
                        >
                          <Badge variant="outline" className="cursor-pointer rounded-md bg-white text-stone-600 hover:bg-stone-50">{category.label}</Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 space-y-2 text-sm text-stone-500">
                  <div>作者：{detailItem.author_name || "社区作者"}</div>
                  <div>发布时间：{detailItem.published_at ? new Date(detailItem.published_at).toLocaleString("zh-CN") : "-"}</div>
                  <div>排名：No. {detailItem.rank}</div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-5">
                    <div>
                      <div className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase">Description</div>
                      <p className="mt-2 text-sm leading-6 text-stone-600">{detailItem.description || "暂无描述"}</p>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase">Prompt</div>
                        <Button
                          variant="outline"
                          className="h-8 rounded-lg border-stone-200 bg-white px-3 text-stone-600"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(detailItem.prompt);
                              toast.success("Prompt 已复制");
                            } catch {
                              toast.error("复制失败，请手动复制");
                            }
                          }}
                        >
                          <Copy className="size-4" />
                          复制
                        </Button>
                      </div>
                      <pre className="max-h-[360px] overflow-auto rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs leading-6 whitespace-pre-wrap text-stone-700">{detailItem.prompt || detailItem.prompt_preview || "暂无 Prompt"}</pre>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-6 py-4">
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-600" onClick={() => (source === "user" ? toggleLike(detailItem) : toggleFavorite(detailItem))}>
                      <Heart className={`size-4 ${source === "user" ? (detailItem.liked_by_me ? "fill-current text-rose-600" : "") : favoriteSet.has(detailItem.id) ? "fill-current text-rose-600" : ""}`} />
                      {source === "user" ? (detailItem.liked_by_me ? "取消点赞" : "点赞") : favoriteSet.has(detailItem.id) ? "取消收藏" : "收藏"}
                    </Button>
                    {source === "user" && canManageUserPrompts ? (
                      <>
                        <Button variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-600" onClick={() => openEditForm(detailItem)}>
                          <Edit3 className="size-4" />
                          管理
                        </Button>
                        <Button variant="outline" className="h-10 rounded-xl border-rose-200 bg-white px-4 text-rose-600" onClick={() => deleteItem(detailItem)}>
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => applyPrompt(detailItem)}>
                    <Wand2 className="size-4" />
                    一键应用
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
