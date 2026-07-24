export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center py-24" aria-busy="true" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
    </main>
  );
}
