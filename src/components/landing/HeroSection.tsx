import { IconArrowRight, IconSolana, IconSparkles, IconWallet, IconPulse } from "../ui/Icons";
import { DemoButton } from "./DemoDialog";
import { ProductPreview } from "./ProductPreview";
import Link from "next/link";

const INDICATORS = [
  { label: "Live Panta Markets", Icon: IconPulse, tone: "text-cyan-300" },
  { label: "AI Briefs", Icon: IconSparkles, tone: "text-violet-300" },
  { label: "Solana Execution", Icon: IconSolana, tone: "text-blue-300" },
  { label: "Your Wallet", Icon: IconWallet, tone: "text-emerald-300" },
];

function SignalLines() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-[38%] h-[360px] w-full opacity-60"
      viewBox="0 0 1440 360"
      preserveAspectRatio="none"
      fill="none"
    >
      <defs>
        <linearGradient id="hero-line-a" x1="0" x2="1">
          <stop offset="0" stopColor="#12D6F5" stopOpacity="0" />
          <stop offset="0.45" stopColor="#12D6F5" stopOpacity="0.35" />
          <stop offset="1" stopColor="#8B5CF6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hero-line-b" x1="0" x2="1">
          <stop offset="0" stopColor="#3478F6" stopOpacity="0" />
          <stop offset="0.6" stopColor="#8B5CF6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8B5CF6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 250 C 260 240, 380 120, 640 150 S 1040 300, 1440 110" stroke="url(#hero-line-a)" strokeWidth="1.5" />
      <path d="M0 300 C 300 290, 500 200, 760 220 S 1160 170, 1440 230" stroke="url(#hero-line-b)" strokeWidth="1.2" />
    </svg>
  );
}

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div className="bg-grid-fine pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="glow-hero pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <SignalLines />

      <div className="relative mx-auto grid max-w-[1320px] items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-8 lg:pb-24 lg:pt-16">
        <div className="rise-in min-w-0">
          <p className="eyebrow eyebrow--pill">AI-native prediction market desk</p>
          <h1 id="hero-title" className="h-hero mt-6">
            <span className="block sm:whitespace-nowrap">Read the market.</span>
            <span className="text-gradient-flow block sm:whitespace-nowrap">See the flow.</span>
            <span className="block sm:whitespace-nowrap">Make your move.</span>
          </h1>
          <p className="text-lede mt-6 max-w-[520px]">
            Live market data from Panta, AI-powered insights, and seamless execution on Solana—all in one place.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/desk" className="btn btn-primary btn-lg">
              Open Trading Desk
              <IconArrowRight className="icon-nudge h-4 w-4" />
            </Link>
            <DemoButton />
          </div>

          <ul
            className="scrollbar-none -mx-5 mt-10 hidden gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-3 xl:flex-nowrap sm:px-0"
            aria-label="What's inside"
          >
            {INDICATORS.map(({ label, Icon, tone }) => (
              <li key={label} className="flex shrink-0 items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface ${tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[13px] font-medium text-ink-2">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rise-in rise-delay-1 relative mx-auto w-full min-w-0 max-w-[920px] xl:mr-[-4.5rem] xl:w-[calc(100%+4.5rem)] xl:max-w-none xl:[perspective:2400px]">
          <div className="glow-soft pointer-events-none absolute -inset-10 -z-10" aria-hidden="true" />
          <ProductPreview className="xl:origin-left xl:[transform:rotateY(-9deg)_rotateX(3deg)]" />
        </div>

        {/* Mobile: indicators after the preview, as a scroll row */}
        <ul className="scrollbar-none -mx-5 -mt-4 flex gap-2 overflow-x-auto px-5 sm:hidden" aria-label="What's inside">
          {INDICATORS.map(({ label, Icon, tone }) => (
            <li key={label} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-2">
              <Icon className={`h-4 w-4 ${tone}`} />
              <span className="text-[13px] font-medium text-ink-2">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
