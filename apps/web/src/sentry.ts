import type { ErrorEvent } from "@sentry/nextjs";

export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) {
      event.request.url = event.request.url.replace(/\/share\/[A-Za-z0-9_-]+/, "/share/:id");
    }
  }
  delete event.user;
  return event;
}
