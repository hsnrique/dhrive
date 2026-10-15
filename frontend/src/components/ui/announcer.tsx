import { createPortal } from "react-dom";

import { useAnnounce } from "@/store/announce";

// The two live regions, on the body beside the app: a modal leaves the app inert, and an inert
// region is never read, while a run that needs the owner must still be heard.
export function Announcer() {
  const polite = useAnnounce((s) => s.polite);
  const assertive = useAnnounce((s) => s.assertive);
  return createPortal(
    <div data-live className="sr-only">
      <div role="status" aria-live="polite">
        {polite && <span key={polite.at}>{polite.text}</span>}
      </div>
      <div aria-live="assertive">
        {assertive && <span key={assertive.at}>{assertive.text}</span>}
      </div>
    </div>,
    document.body,
  );
}
