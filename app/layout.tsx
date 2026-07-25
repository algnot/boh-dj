import type { Metadata } from "next";
import { Anuphan, Chakra_Petch } from "next/font/google";
import "./globals.css";

// Loopless Thai fonts (ฟอนต์ไม่มีหัว)
const anuphan = Anuphan({
  variable: "--font-body",
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "600", "700"],
});

const chakraPetch = Chakra_Petch({
  variable: "--font-display",
  subsets: ["latin", "thai"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "โบ้ DJ",
  description: "ฟัง YouTube ด้วยกันผ่าน LINE — สร้างห้องด้วยคำว่า โบ้",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${chakraPetch.variable} h-full`}
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
