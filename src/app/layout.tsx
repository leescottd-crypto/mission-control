import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Mission Control",
    description: "ClickUp Dashboard with a Linear aesthetic",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark">
            <body className="font-sans antialiased text-sm h-screen overflow-hidden flex bg-background text-text-main">
                {children}
            </body>
        </html>
    );
}
