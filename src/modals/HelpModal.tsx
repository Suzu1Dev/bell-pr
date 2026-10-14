import { Info } from "lucide-react";
import { useT } from "../i18n";
import { Modal } from "./Modal";

/** The four-step guide from importing a repository to sending the PR. */
export function HelpModal({
  closeModal,
  openAbout,
}: {
  closeModal: () => void;
  /** Opens About BELL PR in place of the guide. */
  openAbout?: () => void;
}) {
  const t = useT("modals").help;
  return (
    <Modal title={t.title} subtitle={t.subtitle} onClose={closeModal}>
      <ol className="guide-list">
        {[t.steps.import, t.steps.team, t.steps.understand, t.steps.submit].map(
          (step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </li>
          ),
        )}
      </ol>
      <button className="button primary full-width" onClick={closeModal}>
        {t.start}
      </button>
      {openAbout && (
        <button className="button secondary full-width" onClick={openAbout}>
          <Info size={15} aria-hidden="true" />
          {t.about}
        </button>
      )}
    </Modal>
  );
}
