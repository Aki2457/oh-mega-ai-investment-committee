import type { Metadata } from "next";
import { ResearchChat } from "./ResearchChat";

export const metadata: Metadata = {
  title: "OH MEGA Capital | Investment Command Center",
  description: "Research, Risk, CIO decisions, and simulated portfolio oversight in one command center.",
};

export default function Home() {
  return <ResearchChat />;
}
