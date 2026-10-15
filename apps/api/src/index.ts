import "./env.js";
import { buildRegistry, buildServer } from "@samsara/core";
import { modules } from "./modules.js";

const ordered = buildRegistry(modules);
const enabled = ordered.filter((m) => m.manifest.enabled);

const app = buildServer(ordered, enabled);
const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
  console.log(`[api] modul aktif: ${enabled.map((m) => m.manifest.name).join(", ")}`);
});
