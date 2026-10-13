use crate::flow::Step;

// What each step asks its CLI to do. Every prompt starts with a brief, which also keeps it from
// ever starting with "-" and being read as a flag by the CLI.

const PLAN_BRIEF: &str = "You are the planner for this project. Read the code you need and write a \
step-by-step implementation plan for the task below. Do not edit any file. Name each file to change \
and what changes in it, call out risks, and say how to verify the result. Reply with the plan only. \
If the task is too unclear to plan well, do not guess: ask the owner your questions instead, and end \
that reply with this exact line: DHRIVE: NEEDS ANSWERS";

// The planner's way to say it can't plan yet. Models dress the line up (bold, backticks, a period),
// so only its words are compared, and it never reaches the screen.
const NEEDS_ANSWERS: &str = "dhrive: needs answers";

pub fn split_questions(output: &str) -> (String, bool) {
    let trimmed = output.trim_end();
    let (rest, last) = trimmed.rsplit_once('\n').unwrap_or(("", trimmed));
    let words = last.trim_matches(|c: char| c.is_whitespace() || "*`_.".contains(c)).to_lowercase();
    if words == NEEDS_ANSWERS {
        (rest.trim_end().to_string(), true)
    } else {
        (output.to_string(), false)
    }
}

const CHAT_BRIEF: &str = "You are talking with the owner of this project, who is thinking something \
through. Read the code you need and answer like a sharp colleague: direct, concise, with trade-offs \
where they matter. Do not edit any file and do not run commands that change anything.";

const CODE_BRIEF: &str = "You are the implementer for this project. Carry out the task below. \
Follow the plan unless it is wrong, and say why if you deviate. When you finish, summarize what you \
changed and how you verified it.";

// The maestro only splits; dhrive opens a pane per subtask, each in a worktree of its own, so the
// subtasks must not share files or wait on each other, and each prompt is all its CLI will see.
const SPLIT_BRIEF: &str = "You are the maestro for this project. Read the code you need, then split \
the task below into at most 6 subtasks that separate agents can do at the same time, each in its own \
git worktree of the project, so they must touch different files and must not depend on each other. If \
the task can't be split well, return a single subtask. Do not edit any file. For each subtask pick the \
CLI that suits it best: \"claude\" (Claude Code), \"codex\" (Codex) or \"antigravity\" (Antigravity). \
Write each prompt so it stands alone: its agent sees only that prompt, not the task or the other \
subtasks. Reply with only a JSON array and no other text, like this: \
[{\"title\": \"a few words\", \"cli\": \"claude\", \"prompt\": \"what to do\"}]";

// The company's brief, drafted from what the project says about itself; the owner edits it after. The
// keys are the brief's sections, which the app shows as fields.
const COMPANY_BRIEF: &str = "You are joining this company to help run it. Read the project to learn what it sells and to whom: start with PRODUCT.md, README, the landing or marketing pages and any pricing, then the code only where it helps. Do not edit any file. Write the company's brief: what the product is and the problem it solves, who it is for, the voice it speaks in, the goals worth working toward now, and the channels it reaches people through (ads, social, email, communities), naming any already set up in the project. Be concrete and short, in the language the project speaks to its customers, with no invented numbers or customers. Reply with only a JSON object and no other text, like this: {\"product\": \"...\", \"audience\": \"...\", \"voice\": \"...\", \"goals\": \"...\", \"channels\": \"...\"}";

// The company's day: the brief comes as the task, and each task runs after the owner's OK (or right
// away, if they chose that) as its own code step in the project, one after another. Nothing may reach
// the outside world: what would be published is written as a draft in the project.
const DAY_BRIEF: &str = "You run this company day to day. Read its brief below, then the project as \
far as you need. Suggest the next work: at most 5 tasks that move the goals forward, across code, \
marketing, support and research, the most valuable first, never repeating what's listed below as \
already done or queued. Suggest only work worth its cost: if nothing is worth doing right now, \
reply with an empty array, []. Do not edit any file now. Each task runs \
later as its own agent in this project, one after another, so write each prompt to stand alone: its \
agent sees only that prompt and the project. No task may publish, post, send, buy or spend anything: \
anything meant for the outside world (posts, ads, emails, replies) is written as a draft file in the \
project, under marketing/ unless the project already keeps them elsewhere. Write the tasks in the \
language of the brief. For each task give its area: \"code\", \"marketing\", \"support\" or \
\"research\". Reply with only a JSON array and no other text, like this: [{\"title\": \"a few \
words\", \"area\": \"marketing\", \"prompt\": \"what to do\"}]";

// The company's chat: the owner asks how things stand or what to do next, and the agent answers for
// the company. It only reads; work it thinks worth doing comes back as tasks the owner can add.
const TALK_BRIEF: &str = "You speak for this company to its owner. Its brief is in COMPANY.md, its \
documents in docs/, and what has happened lately is listed below when there is anything new. Read the \
project as far as you need and answer like the company's own operator: direct, short, concrete, in the \
owner's language. Do not edit any file and do not run commands that change anything. When the owner \
asks for work, or your answer points to work worth doing, end your reply with the tasks in a fenced \
block marked tasks, holding only a JSON array like [{\"title\": \"a few words\", \"area\": \"code\", \
\"prompt\": \"what to do, standing alone\"}], at most 3, area one of code, marketing, support or \
research. Leave the block out when there is nothing to do.";

// Founding a company from the owner's sentence, or from nothing at all when they ask to be surprised.
// It runs in an empty folder: the company doesn't exist yet. The keys are its name and the brief's
// sections.
const FOUND_BRIEF: &str = "You are founding a new company with the owner. If their words below \
describe one, found that. If they ask to be surprised, pick one yourself, in the corner of the \
market they point you to: a small online business one person can run with AI agents doing the work, \
that solves a real problem people already pay to solve, sold on the web. Either way, first do a brief \
web search (two or three searches, no more) to check the need is real and current and to see who \
already serves it, and aim where a better product has room. Never settle on the ideas everyone \
reaches for first, like receipt scanners, subscription trackers, to-do lists or AI writing helpers. \
Give it a short, memorable name that isn't a famous brand, then write its \
brief: what the product is and the problem it solves, who it is for, the voice it speaks in, the \
goals for its first weeks, and the channels it should reach people through. It sells to the whole \
world, so write everything in English and give it a name that reads naturally in English, unless the \
owner's words below ask for a particular country or language. Be concrete and short, with no \
invented numbers or customers. Do not create or edit any file. \
Reply with only a JSON object and no other text, like this: {\"name\": \"...\", \"product\": \
\"...\", \"audience\": \"...\", \"voice\": \"...\", \"goals\": \"...\", \"channels\": \"...\"}";

// The changes come in the prompt (github::pending_changes), so the CLI needs no tool to read them.
const COMMIT_BRIEF: &str = "Write the git commit message for the changes below. Reply with only the \
message: a subject line in the imperative mood, under 72 characters, saying what the change does for \
the product, not which files moved; then, only if it helps, a blank line and at most three short \
lines on why. No quotes, no code fences, no prefixes like feat:, no other text. Do not run any \
command or edit any file.";

// "@src/theme.ts" is how the owner points at a file or folder; nothing tells the CLIs that otherwise.
const MENTIONS_NOTE: &str = "(Words starting with @ are files or folders in this project, as paths from its root.)";

fn points_at_files(task: &str) -> bool {
    task.split_whitespace().any(|word| word.len() > 1 && word.starts_with('@') && (word.contains('/') || word.contains('.')))
}

pub fn prompt_for(step: Step, task: &str, plan: Option<&str>) -> String {
    let trimmed = task.trim();
    let task = if points_at_files(trimmed) { format!("{trimmed}\n\n{MENTIONS_NOTE}") } else { trimmed.to_string() };
    match (step, plan.map(str::trim).filter(|p| !p.is_empty())) {
        (Step::Plan, _) => format!("{PLAN_BRIEF}\n\nTask:\n{task}"),
        (Step::Chat, _) => format!("{CHAT_BRIEF}\n\nMessage:\n{task}"),
        (Step::Split, _) => format!("{SPLIT_BRIEF}\n\nTask:\n{task}"),
        (Step::Company, _) => format!("{COMPANY_BRIEF}\n\nThe owner adds:\n{task}"),
        (Step::Day, _) => format!("{DAY_BRIEF}\n\nTask:\n{task}"),
        (Step::Found, _) => format!("{FOUND_BRIEF}\n\nThe owner says:\n{task}"),
        (Step::Talk, _) => format!("{TALK_BRIEF}\n\nThe owner says:\n{task}"),
        (Step::Commit, _) => format!("{COMMIT_BRIEF}\n\nChanges:\n{task}"),
        (Step::Code, None) => format!("{CODE_BRIEF}\n\nTask:\n{task}"),
        (Step::Code, Some(plan)) => format!("{CODE_BRIEF}\n\nTask:\n{task}\n\nPlan to follow:\n{plan}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_company_chat_reads_only_and_hands_work_back_as_tasks() {
        let prompt = prompt_for(Step::Talk, "how are we doing?", None);
        assert!(prompt.starts_with("You speak for this company") && prompt.ends_with("The owner says:\nhow are we doing?"));
        assert!(prompt.contains("Do not edit any file") && prompt.contains("fenced") && prompt.contains("block marked tasks"));
    }
    #[test]
    fn the_commit_message_comes_from_the_changes_alone() {
        let prompt = prompt_for(Step::Commit, "Files (git status):\n M app/page.tsx", None);
        assert!(prompt.starts_with("Write the git commit message") && prompt.ends_with("Changes:\nFiles (git status):\n M app/page.tsx"));
        assert!(prompt.contains("imperative") && prompt.contains("Do not run any command"));
    }
    #[test]
    fn the_plan_step_asks_for_a_plan_and_no_edits() {
        let prompt = prompt_for(Step::Plan, "  add dark mode ", Some("ignored"));
        assert!(prompt.starts_with("You are the planner"));
        assert!(prompt.contains("Do not edit any file") && prompt.ends_with("Task:\nadd dark mode"));
    }
    #[test]
    fn mentioned_files_are_explained_only_when_there_are_some() {
        let prompt = prompt_for(Step::Chat, "why is @src/theme.ts so slow?", None);
        assert!(prompt.ends_with(&format!("why is @src/theme.ts so slow?\n\n{MENTIONS_NOTE}")));
        assert!(!prompt_for(Step::Chat, "ping @ana about it", None).contains(MENTIONS_NOTE));
        assert!(!prompt_for(Step::Chat, "email me at a@b", None).contains(MENTIONS_NOTE));
    }

    #[test]
    fn the_code_step_carries_the_edited_plan_when_there_is_one() {
        let with_plan = prompt_for(Step::Code, "add dark mode", Some("1. add a toggle"));
        assert!(with_plan.starts_with("You are the implementer") && with_plan.ends_with("Plan to follow:\n1. add a toggle"));
        assert!(!prompt_for(Step::Code, "add dark mode", Some("   ")).contains("Plan to follow"));
    }
    #[test]
    fn a_chat_talks_about_the_message_reads_only_and_ignores_any_plan() {
        let prompt = prompt_for(Step::Chat, " should we cache this? ", Some("1. add a cache"));
        assert!(prompt.contains("Do not edit any file") && prompt.ends_with("Message:\nshould we cache this?"));
    }
    #[test]
    fn the_split_step_asks_for_independent_subtasks_as_json_and_no_edits() {
        let prompt = prompt_for(Step::Split, " add dark mode ", Some("ignored"));
        assert!(prompt.starts_with("You are the maestro") && prompt.contains("Do not edit any file"));
        assert!(prompt.contains("only a JSON array") && prompt.ends_with("Task:\nadd dark mode"));
    }
    #[test]
    fn learning_the_company_asks_for_the_brief_s_sections_as_json_and_no_edits() {
        let prompt = prompt_for(Step::Company, " it's a budget app ", None);
        assert!(prompt.starts_with("You are joining this company") && prompt.contains("Do not edit any file"));
        assert!(["\"product\"", "\"audience\"", "\"voice\"", "\"goals\"", "\"channels\""].iter().all(|key| prompt.contains(key)));
        assert!(prompt.ends_with("The owner adds:\nit's a budget app"));
    }
    #[test]
    fn the_day_asks_for_standalone_tasks_as_json_that_never_reach_the_outside_world() {
        let prompt = prompt_for(Step::Day, " # planilha.\n\n## Goals\n\nMore trials ", None);
        assert!(prompt.starts_with("You run this company") && prompt.contains("Do not edit any file now"));
        assert!(prompt.contains("No task may publish, post, send, buy or spend") && prompt.contains("only a JSON array"));
        assert!(prompt.ends_with("Task:\n# planilha.\n\n## Goals\n\nMore trials"));
    }
    #[test]
    fn founding_asks_for_a_name_and_the_brief_as_json_and_can_pick_the_company_itself() {
        let prompt = prompt_for(Step::Found, " surprise me ", None);
        assert!(prompt.starts_with("You are founding a new company") && prompt.contains("If they ask to be surprised, pick one yourself"));
        assert!(prompt.contains("\"name\"") && prompt.contains("Do not create or edit any file"));
        assert!(prompt.contains("write everything in English"), "a company sells to the world unless the owner says otherwise");
        assert!(prompt.contains("brief web search"), "the need is checked, not imagined");
        assert!(prompt.ends_with("The owner says:\nsurprise me"));
    }
    #[test]
    fn a_plan_that_ends_on_the_marker_is_questions_and_loses_the_marker() {
        let (text, asks) = split_questions("Which database: Postgres or SQLite?\n\n**DHRIVE: NEEDS ANSWERS.**\n");
        assert!(asks);
        assert_eq!(text, "Which database: Postgres or SQLite?");
        assert_eq!(split_questions("DHRIVE: NEEDS ANSWERS"), (String::new(), true));
        let plan = "1. Add a cache.\n2. Mention DHRIVE: NEEDS ANSWERS in the docs.";
        assert_eq!(split_questions(plan), (plan.to_string(), false));
        assert!(PLAN_BRIEF.ends_with("DHRIVE: NEEDS ANSWERS"));
    }
}
