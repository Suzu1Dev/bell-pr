import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/contribution.js";

const contribution: Translation<typeof en> = {
  unknown: {
    ghMissing: "沒有安裝 GitHub CLI（gh）。",
    signedOut: "GitHub CLI 還沒登入。請執行 gh auth login，再檢查一次。",
    timeout: "GitHub 沒有及時回應。",
    rateLimited: "已達 GitHub 的速率上限。請等幾分鐘，再檢查一次。",
    notFound: "GitHub 找不到它，或你的帳號看不到它。",
    forbidden: "GitHub 拒絕了你的帳號的這個請求。",
    githubError: "GitHub 回應了錯誤。",
    invalidAnswer: "無法讀取 GitHub 的回應。",
    noGithubOrigin: "這個專案沒有 GitHub 來源，所以沒有可以在 GitHub 上檢查的事。",
    notAnIssue: "這個連結不是 GitHub issue。",
    filesUnreadable: "無法在專案目前的 commit 讀取它的檔案。",
  },
  prCap:
    "GitHub 限制了一個人在這個 repository 同時開著的 Pull Request 數量，而你已經到上限了。請先完成或關閉一個你在這裡開著的 Pull Request，再發布一次。",
  testReasonShort: "每個理由至少要寫 3 個詞，維護者才能查證。",
};

export default contribution;
