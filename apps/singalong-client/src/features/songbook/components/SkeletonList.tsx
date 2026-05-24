function SkeletonSongItem() {
  return (
    <div className="skeleton-item">
      <div className="skeleton skeleton-thumb" />
      <div className="skeleton-info">
        <div className="skeleton skeleton-line skeleton-line--title" />
        <div className="skeleton skeleton-line skeleton-line--meta" />
      </div>
    </div>
  )
}

export function SkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonSongItem key={i} />
      ))}
    </>
  )
}
