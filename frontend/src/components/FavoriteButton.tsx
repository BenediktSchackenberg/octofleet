"use client";

import { useFavorites, Favorite } from "@/hooks/useFavorites";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  type: string;
  id: string;
  label: string;
  href: string;
  className?: string;
}

export function FavoriteButton({ type, id, label, href, className }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(type, id);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite({ type, id, label, href });
      }}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Star
        className={cn(
          "h-4 w-4 transition-colors",
          favorited ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground hover:text-yellow-400"
        )}
      />
    </Button>
  );
}
