import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { beforeSend } from "./sentry";

describe("Sentry privacy scrubber", () => {
  it("drops sensitive request and user fields and normalizes share IDs", () => {
    const event = {
      request: {
        url: "https://nycdiscover.vercel.app/share/abcdefghijklmnopqrstuv",
        data: { location_label: "Private origin" },
        cookies: { session: "secret" },
        headers: { authorization: "Bearer secret" },
        query_string: "token=secret",
      },
      user: { ip_address: "203.0.113.8" },
    } as unknown as ErrorEvent;

    const scrubbed = beforeSend(event);
    expect(scrubbed.request?.url).toBe("https://nycdiscover.vercel.app/share/:id");
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers).toBeUndefined();
    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
  });
});
