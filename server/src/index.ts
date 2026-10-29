import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PrismaRepo } from "./repo/prisma.js";

const config = loadConfig();
const repo = new PrismaRepo();
const app = createApp({ repo, config });

app.listen(config.port, () => {
  console.log(`Money Hub API v${config.version} listening on :${config.port} (${config.isProd ? "production" : "development"})`);
});
