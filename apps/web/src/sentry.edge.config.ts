import * as Sentry from "@sentry/nextjs";
import { beforeSend } from "./sentry";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  sendDefaultPii: false,
  tracesSampleRate: process.env.SENTRY_ENVIRONMENT === "production" ? 0.1 : 0,
  beforeSend,
});
