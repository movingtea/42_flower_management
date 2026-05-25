"use client";

import { useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  onDelete: () => void;
  className?: string;
};

export function SwipeRow({ children, onDelete, className = "" }: Props) {
  const startX = useRef(0);
  const [offset, setOffset] = useState(0);

  return (
    <div
      className={`relative overflow-hidden rounded-xl ${className}`}
      style={{
        transform: `translateX(${offset}px)`,
        transition: "transform 0.2s ease",
      }}
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
      }}
      onTouchMove={(e) => {
        const dx = e.touches[0].clientX - startX.current;
        if (dx < 0) setOffset(Math.max(dx, -96));
      }}
      onTouchEnd={() => {
        if (offset < -64) onDelete();
        setOffset(0);
      }}
    >
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-rose-600 text-sm font-medium text-white">
        删除
      </div>
      <div className="relative bg-white">{children}</div>
    </div>
  );
}
