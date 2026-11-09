import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { initializeModels } from "./models.js";
const app = createApp({
  secret: process.env.JWT_SECRET ?? "",
  origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  production: process.env.NODE_ENV === "production",
});
await mongoose.connect(
  process.env.MONGODB_URI ??
    "mongodb://127.0.0.1:27017/chorequest?replicaSet=rs0&directConnection=true",
);
await initializeModels();
app.listen(Number(process.env.PORT ?? 3001), () =>
  console.log("ChoreQuest API listening on port " + (process.env.PORT ?? 3001)),
);
