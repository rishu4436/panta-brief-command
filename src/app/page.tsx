import { ArenaFeature } from "@/components/landing/v2/ArenaFeature";
import { CapabilityRail } from "@/components/landing/v2/CapabilityRail";
import { CreatorsFeature } from "@/components/landing/v2/CreatorsFeature";
import { DebateFeature } from "@/components/landing/v2/DebateFeature";
import { FinalCall } from "@/components/landing/v2/FinalCall";
import { Hero } from "@/components/landing/v2/Hero";
import { Journey } from "@/components/landing/v2/Journey";
import { ParticipationPaths } from "@/components/landing/v2/ParticipationPaths";
import { PlatformFeature } from "@/components/landing/v2/PlatformFeature";
import { RoomsFeature } from "@/components/landing/v2/RoomsFeature";
import { communityAvailabilityAtBuild } from "@/lib/rooms/availability";

/**
 * Landing v2. Server-rendered sections with static, illustrative product
 * compositions; the only client code is the platform module switcher (and
 * the desk components it lazy-loads). No Panta requests from this page.
 */
export default function LandingPage() {
  // On a read-only preview without community storage, say so up front instead
  // of implying Rooms, Arena and Studio work there. Production never shows it
  // (even if its store env were missing at build time), so a static build can't
  // put a false notice on the live site; the gated pages still explain.
  const { available, readOnly } = communityAvailabilityAtBuild();
  return (
    <>
      <Hero communityNotice={!available && readOnly} />
      <CapabilityRail />
      <ParticipationPaths />
      <RoomsFeature />
      <ArenaFeature />
      <DebateFeature />
      <CreatorsFeature />
      <PlatformFeature />
      <Journey />
      <FinalCall />
    </>
  );
}
