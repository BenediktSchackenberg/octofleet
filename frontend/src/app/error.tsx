"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
      <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-red-500 mb-2">Something went wrong</h2>
        <pre className="text-sm text-zinc-400 bg-zinc-950 p-3 rounded overflow-auto max-h-60 mb-4">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
