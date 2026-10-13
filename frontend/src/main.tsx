import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

// In a plain browser during development there is no Rust backend; stand in for it so the UI can
// be seen and exercised. Production builds drop this branch entirely.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev/mock");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
