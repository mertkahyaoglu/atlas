interface EmptyStateProps {
  title: string;
  action?: React.ReactNode;
}

/** An empty result set is a dead end unless it offers the way back out. */
export function EmptyState({ title, action }: EmptyStateProps) {
  return (
    <div className="rounded border border-dashed border-rule px-6 py-12 text-center">
      <p className="text-small text-inkMuted">{title}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
