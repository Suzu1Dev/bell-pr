import { useEffect, useState } from "react";
import type { SuiteLinks, SuiteManifest } from "../../../shared/suite";
import { api } from "../../api";

/**
 * The other BELL products this BELL PR links to (GET /api/suite/manifest),
 * read once. Undefined while the read is on its way, when it fails and when
 * no product is linked: the product switcher only shows for a link.
 */
export function useSuiteLinks(): SuiteLinks | undefined {
  const [links, setLinks] = useState<SuiteLinks>();
  useEffect(() => {
    let mounted = true;
    api<SuiteManifest>("/suite/manifest").then(
      (manifest) => {
        if (mounted && Object.keys(manifest.links ?? {}).length) setLinks(manifest.links);
      },
      () => {
        // No switcher: BELL PR works the same without it.
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  return links;
}
