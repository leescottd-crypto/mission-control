"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
    className?: string;
}

function NdiBrandMark({ className }: BrandMarkProps) {
    return (
        <div className={cn("flex shrink-0 items-center justify-center overflow-hidden", className)}>
            <Image
                src="/ndi-icon.svg"
                alt="Mission Control logo"
                width={1080}
                height={1080}
                className="h-full w-full object-contain"
            />
        </div>
    );
}

export function MissionControlMark({ className }: BrandMarkProps) {
    return <NdiBrandMark className={className} />;
}

export function MissionEngineMark({ className }: BrandMarkProps) {
    return <NdiBrandMark className={className} />;
}
