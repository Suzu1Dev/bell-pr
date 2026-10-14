/**
 * Saves `text` as a file named `name` through the browser's download, from
 * a Blob: no request is made, so a gated or failed answer can never end up
 * saved in its place.
 */
export function saveTextFile(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked once the click has handed the Blob to the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
