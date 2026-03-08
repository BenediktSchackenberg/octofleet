'use client';
export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="text-red-400 text-lg font-semibold">Something went wrong</div>
      <p className="text-zinc-400 text-sm max-w-md text-center">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition">
        Try again
      </button>
    </div>
  );
}
