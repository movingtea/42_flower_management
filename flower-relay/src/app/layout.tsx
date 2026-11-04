import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "花材接力 · Flower Relay",
  description: "为花艺样品规划拆解复用顺序，减少采购与浪费。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
