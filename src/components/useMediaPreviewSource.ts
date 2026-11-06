import { useEffect, useState } from "react";
import {
  isEncryptedRoamMedia,
  resolveMediaPreviewSource,
} from "~/utils/media/source";

type PreviewState = {
  revision: number;
  original: string;
  url: string | null;
  failed: boolean;
};

const useMediaPreviewSource = (
  url: string | null,
  revision = 0,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [resolved, setResolved] = useState<PreviewState | null>(null);
  const needsDecryption = Boolean(url && isEncryptedRoamMedia(url));
  useEffect(() => {
    if (!url || !needsDecryption) {
      setResolved(null);
      return;
    }
    let active = true;
    let release: (() => void) | undefined;
    void resolveMediaPreviewSource(url)
      .then((source) => {
        if (!active) {
          source.release();
          return;
        }
        release = source.release;
        setResolved({
          revision,
          original: url,
          url: source.url,
          failed: false,
        });
      })
      .catch(() => {
        if (active)
          setResolved({ revision, original: url, url: null, failed: true });
      });
    return () => {
      active = false;
      release?.();
    };
  }, [url, needsDecryption, revision]);
  if (!needsDecryption) return { url, loading: false, failed: false };
  if (resolved?.original !== url || resolved.revision !== revision)
    return { url: null, loading: true, failed: false };
  return { url: resolved.url, loading: false, failed: resolved.failed };
};

export default useMediaPreviewSource;
