'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { privacySections, schoolPhrase, UNOFFICIAL_LABEL, unofficialNotice } from '@/lib/planner/notices';

/**
 * The unofficial label and the privacy notice, on every screen.
 *
 * The planner header carries <UnofficialBadge>, a label that is never hidden
 * (narrow screens included) with the full sentence beside it where there is
 * room; the onboarding screens carry <SiteFooter>, the full sentence and a
 * Privacy link. Both open <PrivacyDialog>, which says what is stored and sent
 * (lib/planner/notices.ts). A link to the page with #privacy opens it too.
 */

export function PrivacyDialog({ open, onOpenChange, schoolName, bot }: { open: boolean; onOpenChange: (open: boolean) => void; schoolName: string | null; bot: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="privacy-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About this planner and your privacy</DialogTitle>
          <DialogDescription>{unofficialNotice(schoolName)}</DialogDescription>
        </DialogHeader>
        <div className="privacy-body">
          {privacySections(bot).map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the privacy dialog when the address ends in #privacy, and on request. */
function usePrivacyDialog(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      if (window.location.hash === '#privacy') setOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  const change = (next: boolean) => {
    setOpen(next);
    if (!next && window.location.hash === '#privacy') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };
  return [open, change];
}

/** For the planner header: the label, the sentence where it fits, and the Privacy link. */
export function UnofficialBadge({ schoolName, bot }: { schoolName: string | null; bot: string }) {
  const [open, setOpen] = usePrivacyDialog();
  const notice = unofficialNotice(schoolName);
  return (
    <div className="unofficial">
      <button type="button" className="unofficial-label" title={notice} aria-label={`${UNOFFICIAL_LABEL}. ${notice} About and privacy.`} onClick={() => setOpen(true)}>
        <Info aria-hidden="true" />
        {UNOFFICIAL_LABEL}
      </button>
      <span className="unofficial-text">
        Not affiliated with or endorsed by {schoolPhrase(schoolName)}. Check plans with your advisor.
      </span>
      <button type="button" className="unofficial-link" onClick={() => setOpen(true)}>
        Privacy
      </button>
      <PrivacyDialog open={open} onOpenChange={setOpen} schoolName={schoolName} bot={bot} />
    </div>
  );
}

/** For the onboarding screens: the full sentence and the Privacy link, under the questions. */
export function SiteFooter({ schoolName, bot }: { schoolName: string | null; bot: string }) {
  const [open, setOpen] = usePrivacyDialog();
  return (
    <footer className="site-footer">
      <span className="unofficial-label" aria-hidden="true">
        {UNOFFICIAL_LABEL}
      </span>
      <p className="site-footer-notice">{unofficialNotice(schoolName)}</p>
      <button type="button" className="unofficial-link" onClick={() => setOpen(true)}>
        Privacy: what this app stores and sends
      </button>
      <PrivacyDialog open={open} onOpenChange={setOpen} schoolName={schoolName} bot={bot} />
    </footer>
  );
}
