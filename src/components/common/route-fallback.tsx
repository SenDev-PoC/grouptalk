export function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <span className="bg-primary/70 size-2.5 animate-soft-pulse rounded-full" />
      <span className="sr-only">불러오는 중</span>
    </div>
  )
}
