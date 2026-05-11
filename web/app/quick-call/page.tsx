import { Metadata } from "next";
import QuickCallClient from "./QuickCallClient";

export const metadata: Metadata = {
  title: "Appel rapide — Socle CRM",
};

export default function QuickCallPage() {
  return <QuickCallClient />;
}
