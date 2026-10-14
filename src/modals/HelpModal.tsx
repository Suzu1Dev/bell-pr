import { useT } from "../i18n";
import { Modal } from "./Modal";

/** The four-step guide from importing a repository to sending the PR. */
export function HelpModal({ closeModal }: { closeModal: () => void }) {
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
    </Modal>
  );
}
