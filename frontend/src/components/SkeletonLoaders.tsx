'use client';

// ─────────────────────────────────────────────────────────
// REUSABLE TAILWIND SKELETON LOADERS
// ─────────────────────────────────────────────────────────
// Shimmering placeholders that match the exact visual layout
// of each tab in the Analysis Dashboard while AI fetches data.
// ─────────────────────────────────────────────────────────

export function ArchitectureSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Overview Box Skeleton */}
      <div className="bg-panel p-6 rounded-2xl border border-border space-y-3">
        <div className="h-3 bg-border rounded w-32" />
        <div className="h-4 bg-border/60 rounded w-full" />
        <div className="h-4 bg-border/60 rounded w-5/6" />
        <div className="h-4 bg-border/60 rounded w-3/4" />
      </div>

      {/* Mermaid Diagram Box Skeleton */}
      <div className="bg-panel p-8 rounded-2xl border border-border flex flex-col items-center justify-center gap-3 h-64">
        <div className="h-10 w-10 bg-border rounded-full" />
        <div className="h-3 bg-border rounded w-48" />
        <div className="h-2 bg-border/50 rounded w-32" />
      </div>

      {/* Tech Stack & Dependencies Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-panel p-5 rounded-2xl border border-border space-y-3">
          <div className="h-3 bg-border rounded w-28" />
          <div className="flex flex-wrap gap-2 pt-1">
            <div className="h-6 w-16 bg-border rounded-lg" />
            <div className="h-6 w-20 bg-border rounded-lg" />
            <div className="h-6 w-14 bg-border rounded-lg" />
          </div>
        </div>

        <div className="bg-panel p-5 rounded-2xl border border-border space-y-3">
          <div className="h-3 bg-border rounded w-28" />
          <div className="flex flex-wrap gap-2 pt-1">
            <div className="h-6 w-18 bg-border rounded-lg" />
            <div className="h-6 w-14 bg-border rounded-lg" />
            <div className="h-6 w-22 bg-border rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BugsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Summary Box Skeleton */}
      <div className="bg-panel p-5 rounded-2xl border border-border flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-border rounded w-48" />
          <div className="h-3 bg-border/60 rounded w-3/4" />
        </div>
        <div className="h-8 w-12 bg-border rounded-xl" />
      </div>

      {/* Bug Cards Skeletons */}
      {[1, 2].map((i) => (
        <div key={i} className="bg-panel p-6 rounded-2xl border border-border space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-16 bg-border rounded-full" />
            <div className="h-4 w-40 bg-border rounded" />
          </div>
          <div className="h-3 bg-border/60 rounded w-full" />
          <div className="h-3 bg-border/60 rounded w-4/5" />
          <div className="h-20 bg-background rounded-xl border border-border" />
        </div>
      ))}
    </div>
  );
}

export function DocsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-pulse">
      {/* Sidebar ToC Skeleton */}
      <div className="hidden lg:block lg:col-span-1 bg-panel border border-border p-4 rounded-2xl space-y-3">
        <div className="h-3 bg-border rounded w-24" />
        <div className="space-y-2 pt-2">
          <div className="h-3 bg-border/60 rounded w-full" />
          <div className="h-3 bg-border/60 rounded w-5/6" />
          <div className="h-3 bg-border/60 rounded w-4/5" />
          <div className="h-3 bg-border/60 rounded w-2/3" />
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="lg:col-span-3 bg-panel p-8 rounded-2xl border border-border space-y-4">
        <div className="h-7 bg-border rounded w-1/2 mb-6" />
        <div className="h-4 bg-border/60 rounded w-full" />
        <div className="h-4 bg-border/60 rounded w-11/12" />
        <div className="h-4 bg-border/60 rounded w-3/4" />
        <div className="h-5 bg-border rounded w-1/3 mt-6 mb-2" />
        <div className="h-4 bg-border/60 rounded w-full" />
        <div className="h-4 bg-border/60 rounded w-5/6" />
      </div>
    </div>
  );
}