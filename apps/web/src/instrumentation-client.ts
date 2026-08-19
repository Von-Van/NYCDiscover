import * as Sentry from "@sentry/nextjs";
import { beforeSend } from "./sentry";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  sendDefaultPii: false,
  tracesSampleRate:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production" ? 0.1 : 0,
  beforeSend,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
