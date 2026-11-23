import app from "./app.js";
import { config } from "./config/index.js";

app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port} (${config.env})`);
});
