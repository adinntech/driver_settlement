import express from "express";
import cors from "cors";
import morgan from "morgan";
import { config } from "./config/index.js";
import routes from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(morgan(config.env === "production" ? "combined" : "dev"));
app.use(express.json());

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
