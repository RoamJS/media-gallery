import { useEffect, useState } from "react";

const readHostDark = (): boolean => {
  const root = document.querySelector<HTMLElement>(".roam-body, .roam-app");
  if (
    document.body.classList.contains("bp3-dark") ||
    root?.closest(".bp3-dark") ||
    root?.querySelector(".bp3-dark")
  )
    return true;
  const background = getComputedStyle(root || document.body).backgroundColor;
  const channels = background.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3 || channels[3] === 0) return false;
  return (
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 128
  );
};

const useGalleryEnvironment = (): { narrow: boolean; dark: boolean } => {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const [dark, setDark] = useState(readHostDark);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onResize = (): void => setNarrow(media.matches);
    media.addEventListener("change", onResize);
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDark(readHostDark());
      });
    });
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      media.removeEventListener("change", onResize);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return { narrow, dark };
};
export default useGalleryEnvironment;
