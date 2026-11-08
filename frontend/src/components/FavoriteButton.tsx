"use client";

import { useI18n } from "@/lib/i18n-context";

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
  const { t } = useI18n();

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
      title={favorited ? t("widgets.favorites.remove") : t("widgets.favorites.add")}
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
