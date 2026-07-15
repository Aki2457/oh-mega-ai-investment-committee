import type { Metadata } from "next";
import { ResearchChat } from "./ResearchChat";

export const metadata: Metadata = {
  title: "OH MEGA Capital | Investment Command Center",
  description: "Decision, Risk, CEO, and Human oversight for a safety-first virtual fund.",
};

export default function Home() {
  return <ResearchChat />;
}
