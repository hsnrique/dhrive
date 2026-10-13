// A CLI's reply as a commit message: whatever it wrapped the message in (a fence, quotes, a "Commit
// message:" label) comes off, the subject line keeps under 72 characters, and empty means nothing.
const SUBJECT_MAX = 72;

export function commitMessage(output: string): string | null {
  const unfenced = output.replace(/^\s*```[a-z]*\s*\n?|\n?```\s*$/gi, "").trim();
  const unlabeled = unfenced.replace(/^(commit message|message)\s*:\s*/i, "");
  const lines = unlabeled.split("\n").map((line) => line.trimEnd());
  const subject = lines[0]?.trim().replace(/^["'`]+|["'`]+$/g, "") ?? "";
  if (!subject) return null;
  const short = subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : subject;
  const body = lines.slice(1).join("\n").trim();
  return body ? `${short}\n\n${body}` : short;
}
