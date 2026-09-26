import { IconArrowRight } from "../ui/Icons";
import { DemoButton } from "./DemoDialog";
import { ProductPreview } from "./ProductPreview";
import Link from "next/link";

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

      <div className="relative mx-auto grid max-w-[1320px] items-center gap-10 px-5 pb-12 pt-10 sm:px-8 sm:pt-14 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-8 lg:pb-16 lg:pt-14">
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

        </div>

        <div className="rise-in rise-delay-1 relative mx-auto w-full min-w-0 max-w-[920px] min-[1400px]:mr-[-4.5rem] min-[1400px]:w-[calc(100%+4.5rem)] xl:max-w-none xl:[perspective:2400px]">
          <div className="glow-soft pointer-events-none absolute -inset-10 -z-10" aria-hidden="true" />
          <ProductPreview className="xl:origin-left xl:[transform:rotateY(-9deg)_rotateX(3deg)]" />
        </div>

      </div>
    </section>
  );
}
