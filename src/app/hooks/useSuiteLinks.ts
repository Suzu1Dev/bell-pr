import { useEffect, useState } from "react";
import type { SuiteLinks, SuiteManifest } from "../../../shared/suite";
import { api } from "../../api";
import { safeLink } from "../../review/MarkdownContent";

/**
 * The other BELL products this BELL PR links to (GET /api/suite/manifest),
 * read once. Undefined while the read is on its way, when it fails, when
 * the answer is not a manifest and when it holds no address the switcher
 * can link to: the product switcher only shows for a link.
 */
export function useSuiteLinks(): SuiteLinks | undefined {
  const [links, setLinks] = useState<SuiteLinks>();
  useEffect(() => {
    let mounted = true;
    // A proxy or another build may answer with something else than a manifest.
    api<Partial<SuiteManifest> | undefined>("/suite/manifest")
      .then((manifest) => {
        const usable: SuiteLinks = {};
        for (const id of ["explain", "personal", "reader", "campaign"] as const) {
          const origin = manifest?.links?.[id];
          if (typeof origin === "string" && safeLink(origin)) usable[id] = origin;
        }
        if (mounted && Object.keys(usable).length) setLinks(usable);
      })
      .catch(() => {
        // No switcher: BELL PR works the same without it.
      });
    return () => {
      mounted = false;
    };
  }, []);
  return links;
}
