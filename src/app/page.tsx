import { AIBriefShowcase } from "@/components/landing/AIBriefShowcase";
import { CapabilityStrip } from "@/components/landing/CapabilityStrip";
import { ExecutionShowcase } from "@/components/landing/ExecutionShowcase";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { HeroSection } from "@/components/landing/HeroSection";
import { MarketShowcase } from "@/components/landing/MarketShowcase";
import { PortfolioShowcase } from "@/components/landing/PortfolioShowcase";
import { WorkflowSteps } from "@/components/landing/WorkflowSteps";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <CapabilityStrip />
      <WorkflowSteps />
      <MarketShowcase />
      <AIBriefShowcase />
      <ExecutionShowcase />
      <PortfolioShowcase />
      <FinalCTA />
    </>
  );
}
