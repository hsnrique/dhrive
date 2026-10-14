// The engineering standard every company's code is held to, whoever writes it. It lives in the app,
// not in each repo: a better standard reaches every company with the next release of dhrive. The
// four scripts it names are what dhrive itself runs to check a delivery.

export const CHECKS = ["lint", "typecheck", "test", "build"] as const;

// How an agent works when its company runs lean: the work itself, not the telling of it. Output is the
// costliest token and what weighs most against a plan's limit; the one closing line is what the task
// row, the war room and the checks' verdict read.
export const LEAN = "Spend few words. Work without narrating: no preamble, no restating the task, no plan written out before you start, no recap of what you read or changed. Between steps say nothing, or a few words at most. Finish with one line: what you changed and which checks passed.";

export const STANDARDS = `Work to this engineering standard; it is what every company's code is held to.

Architecture
- Keep three layers apart. Components only render and handle input. The product's rules live in plain, typed functions under lib/ that know nothing of React. Anything outside the app (storage, fetch, a service's SDK) sits behind one small module per service under services/, never called from a component.
- One responsibility per file. Aim for 200 lines, never over 300; keep functions under 30 lines. When a file grows, extract before adding to it.
- Follow the structure, names and patterns already in the project before inventing new ones, and read the code you touch first. docs/architecture.md says what the layers are and where things live: read it, write it if the project has none yet, and update it whenever the structure changes.
- TypeScript strict, no \`any\`. Check every input from outside (forms, URLs, storage, responses) where it enters, and handle failure with a state the user sees, never a blank screen or a swallowed error.
- One source of truth for each piece of state; derive the rest.

Quality
- Tests come with the code: unit tests (Vitest) for every rule in lib/, a test that fails without the fix for every bug fixed, and one end-to-end check of the core flow once it exists.
- Accessible and responsive by default: semantic HTML, labels, keyboard use, visible focus, readable contrast, and layouts that work from 360px wide.
- No AI slop: for any interface, use the impeccable skill if you have it, and design with intent, with a real point of view instead of generic gradients, card grids and filler copy.
- Anything on the web is Next.js (the latest release) with the App Router and TypeScript, never plain HTML and CSS, and stays a static export (output: "export") so it can be published.
- Pin every dependency to an exact version, and don't add one for what a few lines do. Never hardcode a secret: read keys from environment variables and keep their names in .env.example.
- Leave no dead code, commented-out code or TODOs behind.

Done means verified
- package.json keeps the scripts ${CHECKS.join(", ")} (typecheck is tsc --noEmit, test is vitest run). Before you finish, run all four, fix every failure, and say what you ran and what passed.`;
