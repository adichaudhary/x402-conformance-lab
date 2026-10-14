// Starts the mock resource server: npm run mock:server [-- --port 4402 --fault decimal-amount]
import { serve } from "@hono/node-server";
import { parseArgs } from "node:util";
import { createMockServer, type MockServerFault } from "./app.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.PORT ?? "4402" },
    fault: { type: "string", multiple: true, default: [] },
  },
});

const port = Number(values.port);
const app = createMockServer({ faults: values.fault as MockServerFault[] });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Mock x402 server listening on http://localhost:${info.port}/paid`);
  if (values.fault.length) console.log(`Faults enabled: ${values.fault.join(", ")}`);
});
