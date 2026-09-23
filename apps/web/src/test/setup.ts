import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetDiscoverySession } from "@/lib/discovery-session";

afterEach(() => { cleanup(); resetDiscoverySession(); });
