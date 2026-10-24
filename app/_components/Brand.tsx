import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="LimitLeague home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/limitleague-logo.svg" alt="" width={34} height={34} />
      {!compact && (
        <span className="brand-word">
          Limit<span>League</span>
        </span>
      )}
    </Link>
  );
}
