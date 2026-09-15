"use client";

import { useRouter } from "next/navigation";
import { useFilterStore } from "@/store/useFilterStore";
import { Tag } from "@/components/ui/Tag";

/** A tag on a doc jumps back to the library, filtered to just that tag. */
export function DocTags({ tags }: { tags: string[] }) {
  const router = useRouter();
  const showOnlyTag = useFilterStore((s) => s.showOnlyTag);

  function openTag(id: string) {
    showOnlyTag(id);
    router.push("/#library");
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Tag key={tag} id={tag} onClick={openTag} />
      ))}
    </div>
  );
}
