import type { Metadata } from "next";
import "reactflow/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Harness Studio",
    template: "%s | Harness Studio",
  },
  description: "Visual workbench for building, inspecting, and running structured multi-agent harnesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
