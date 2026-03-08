import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const etBook = localFont({
  src: [
    {
      path: "../../public/fonts/serif/etbookot-roman-webfont.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/serif/etbookot-italic-webfont.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../public/fonts/serif/etbookot-bold-webfont.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Private Ethereum Assistant",
  description: "A fully private, local-first chatbot for Ethereum interactions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${etBook.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
