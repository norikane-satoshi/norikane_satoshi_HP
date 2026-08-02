export function ProfileToolBadges({ tools }: { tools: readonly string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 @[680px]/profile:justify-start">
      {tools.map((tool) => (
        <span
          key={tool}
          className="glass-badge glass-badge--profile-tool px-3 py-1 text-xs font-medium"
        >
          {tool}
        </span>
      ))}
    </div>
  )
}
