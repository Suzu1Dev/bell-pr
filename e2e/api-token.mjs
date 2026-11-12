/** The token every e2e server writes to `<data dir>/api-token` before it starts. */
export const e2eApiToken =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const e2eApiHeaders = {
  Authorization: `Bearer ${e2eApiToken}`,
};
