import { Modal } from "./Modal";

/** The four-step guide from importing a repository to sending the PR. */
export function HelpModal({ closeModal }: { closeModal: () => void }) {
  return (
    <Modal
      title="從想法，到你的下一個 PR。"
      subtitle="四個步驟，把開發、審查與學習串在一起。"
      onClose={closeModal}
    >
      <ol className="guide-list">
        <li>
          <strong>帶入 Repository</strong>
          <p>匯入 GitHub 連結或本機路徑，選擇要貢獻的專案。</p>
        </li>
        <li>
          <strong>指揮 Agent team</strong>
          <p>清楚描述需求，讓規劃、開發與審查角色完成分工。</p>
        </li>
        <li>
          <strong>理解每個改動</strong>
          <p>
            切換檔案閱讀 diff；點選行號，或按住 Shift 選擇一段程式碼，向
            agent 提問。理解後勾選「已審閱」。
          </p>
        </li>
        <li>
          <strong>編輯並送出 PR</strong>
          <p>調整標題與說明，儲存草稿，完成所有檔案審查後確認送出。</p>
        </li>
      </ol>
      <button className="button primary full-width" onClick={closeModal}>
        開始探索
      </button>
    </Modal>
  );
}
