import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport } from "../../src/report/json.js";
import { loadCatalog } from "../../src/runner/catalog.js";
import { parseConfig } from "../../src/runner/config.js";
import { runTests } from "../../src/runner/run.js";
import {
  createMockServer,
  MOCK_PAID_CONTENT_MARKER,
  type MockServerFault,
} from "../../src/mocks/server/app.js";

const srv06 = loadCatalog().tests.find((t) => t.id === "SRV-06")!;

let server: ServerType | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function runAgainstMock(faults: MockServerFault[] = []) {
  const app = createMockServer({ faults });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
  });
  const config = parseConfig({
    name: "mock",
    role: "server",
    url: `http://localhost:${port}`,
    resource: { path: "/paid", paidContentMarker: MOCK_PAID_CONTENT_MARKER },
    features: ["scheme:exact"],
  });
  const report = await runTests([srv06], config);
  return { report, result: report.results[0]! };
}
