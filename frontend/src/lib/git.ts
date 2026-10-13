// What a step's commit starts from: a message and a branch name taken from the request, both edited
// freely before committing.

const MAX_SUBJECT = 72;
const MAX_SLUG = 40;

// The request's first line, cut to a commit subject, which by convention ends without a period.
export function commitMessage(task: string): string {
  const line = (task.split("\n").map((l) => l.trim()).find(Boolean) ?? "").replace(/\.+$/, "");
  const subject = line.charAt(0).toUpperCase() + line.slice(1);
  const chars = [...subject];
  return chars.length > MAX_SUBJECT ? `${chars.slice(0, MAX_SUBJECT - 1).join("").trimEnd()}…` : subject;
}

// "Adicionar retries ao webhook!" → "dhrive/adicionar-retries-ao-webhook"
export function branchName(task: string): string {
  const words = task
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  return `dhrive/${slug || "change"}`;
}
