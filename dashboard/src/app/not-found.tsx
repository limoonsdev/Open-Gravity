import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="brand-text text-[64px] leading-none font-semibold tracking-tight">404</p>
      <h1 className="mt-4 text-xl font-semibold">This page does not exist</h1>
      <p className="mt-1.5 text-[14px] text-fg-3">The link may be outdated, or the page moved in this version of the dashboard.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-[14px] font-medium text-accent-fg hover:brightness-110">
        Back to overview
      </Link>
    </div>
  );
}
