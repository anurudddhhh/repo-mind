import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastContainer } from "@/components/Toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Repo-Mind | AI GitHub Assistant",
  description: "Chat with your codebase using AI and RAG",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground min-h-screen`}>
        {children}
        {/* Global Toast Notification Layer */}
        {/* Why here? layout.tsx wraps ALL pages, so toasts work everywhere. */}
        {/* ToastContainer uses fixed positioning + z-[100] to float above all content. */}
        <ToastContainer />
      </body>
    </html>
  );
}