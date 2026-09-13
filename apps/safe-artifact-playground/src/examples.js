const typeRef = (name, version) => ({ name, version, digest: "sha256-poc-example" });

const deploymentType = {
  kind: "safeartifact/type-definition",
  specVersion: "0.1",
  name: "demo.deployment-status",
  version: "1.0.0",
  contentSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "observedAt", "services"],
    properties: {
      summary: { type: "string", maxLength: 4000 },
      observedAt: { type: "dateTime" },
      services: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "status", "version"],
          properties: {
            name: { type: "string", maxLength: 100 },
            status: { type: "string", enum: ["healthy", "degraded", "down"] },
            version: { type: "string", maxLength: 100 },
          },
        },
      },
    },
  },
  view: {
    kind: "stack",
    gap: "large",
    children: [
      { kind: "text", value: { path: "/summary" }, emphasis: "lead" },
      { kind: "dateTime", value: { path: "/observedAt" }, label: "Observed" },
      {
        kind: "table",
        rows: { path: "/services" },
        columns: [
          { header: "Service", value: { path: "/name" } },
          { header: "Status", value: { path: "/status" } },
          { header: "Version", value: { path: "/version" } },
        ],
      },
    ],
  },
};

const deploymentArtifacts = [
  {
    label: "Healthy deployment",
    value: {
      specVersion: "0.1",
      id: "deploy-2026-09-13-001",
      type: typeRef(deploymentType.name, deploymentType.version),
      title: "Production deployment",
      createdAt: "2026-09-13T09:00:00Z",
      producer: "deployment-agent/1.4.0",
      content: {
        summary: "Deployment completed successfully. All services are healthy.",
        observedAt: "2026-09-13T09:03:12Z",
        services: [
          { name: "API", status: "healthy", version: "2026.09.13.1" },
          { name: "Worker", status: "healthy", version: "2026.09.13.1" },
          { name: "Scheduler", status: "healthy", version: "2026.09.13.1" },
        ],
      },
    },
  },
  {
    label: "Degraded service",
    value: {
      specVersion: "0.1",
      id: "deploy-2026-09-13-002",
      type: typeRef(deploymentType.name, deploymentType.version),
      title: "Production deployment",
      createdAt: "2026-09-13T09:20:00Z",
      producer: "deployment-agent/1.4.0",
      content: {
        summary: "Deployment completed, but Worker latency is above the service objective.",
        observedAt: "2026-09-13T09:24:31.240Z",
        services: [
          { name: "API", status: "healthy", version: "2026.09.13.2" },
          { name: "Worker", status: "degraded", version: "2026.09.13.2" },
          { name: "Scheduler", status: "healthy", version: "2026.09.13.2" },
        ],
      },
    },
  },
  {
    label: "Invalid dateTime",
    value: {
      specVersion: "0.1",
      id: "deploy-invalid-date",
      type: typeRef(deploymentType.name, deploymentType.version),
      title: "Invalid deployment report",
      createdAt: "2026-09-13T09:20:00Z",
      content: {
        summary: "This example demonstrates semantic dateTime validation.",
        observedAt: "2026-02-30T09:24:31Z",
        services: [{ name: "API", status: "healthy", version: "dev" }],
      },
    },
  },
];

const testRunType = {
  kind: "safeartifact/type-definition",
  specVersion: "0.1",
  name: "demo.test-run-summary",
  version: "1.0.0",
  contentSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "finishedAt", "passed", "failed", "failures"],
    properties: {
      summary: { type: "string", maxLength: 2000 },
      finishedAt: { type: "dateTime" },
      passed: { type: "integer", minimum: 0 },
      failed: { type: "integer", minimum: 0 },
      failures: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["test", "message"],
          properties: {
            test: { type: "string", maxLength: 300 },
            message: { type: "string", maxLength: 4000 },
          },
        },
      },
    },
  },
  view: {
    kind: "stack",
    gap: "large",
    children: [
      { kind: "text", value: { path: "/summary" }, emphasis: "lead" },
      {
        kind: "grid",
        columns: 3,
        gap: "medium",
        children: [
          { kind: "number", value: { path: "/passed" }, label: "Passed" },
          { kind: "number", value: { path: "/failed" }, label: "Failed" },
          { kind: "dateTime", value: { path: "/finishedAt" }, label: "Finished" },
        ],
      },
      {
        kind: "section",
        title: "Failures",
        children: [
          {
            kind: "table",
            rows: { path: "/failures" },
            columns: [
              { header: "Test", value: { path: "/test" } },
              { header: "Message", value: { path: "/message" } },
            ],
          },
        ],
      },
    ],
  },
};

const testRunArtifacts = [
  {
    label: "Passing run",
    value: {
      specVersion: "0.1",
      id: "run-4821",
      type: typeRef(testRunType.name, testRunType.version),
      title: "API regression suite",
      createdAt: "2026-09-13T10:10:00Z",
      content: {
        summary: "The regression suite completed without failures.",
        finishedAt: "2026-09-13T10:09:54Z",
        passed: 184,
        failed: 0,
        failures: [],
      },
    },
  },
  {
    label: "Failing run",
    value: {
      specVersion: "0.1",
      id: "run-4822",
      type: typeRef(testRunType.name, testRunType.version),
      title: "API regression suite",
      createdAt: "2026-09-13T10:35:00Z",
      content: {
        summary: "Two concurrency tests failed after the scheduler change.",
        finishedAt: "2026-09-13T10:34:41Z",
        passed: 182,
        failed: 2,
        failures: [
          { test: "fairness preserves tenant order", message: "Expected tenant-b before tenant-c." },
          { test: "lease expires after shutdown", message: "Lease remained active for 31 seconds." },
        ],
      },
    },
  },
];

const changeSetType = {
  kind: "safeartifact/type-definition",
  specVersion: "0.1",
  name: "demo.change-set",
  version: "1.0.0",
  contentSchema: {
    type: "object",
    additionalProperties: false,
    required: ["intent", "author", "files", "verification"],
    properties: {
      intent: { type: "string", maxLength: 2000 },
      author: { type: "string", maxLength: 200 },
      files: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
      verification: { type: "array", maxItems: 50, items: { type: "string", maxLength: 1000 } },
    },
  },
  view: {
    kind: "stack",
    gap: "large",
    children: [
      { kind: "text", value: { path: "/intent" }, emphasis: "lead" },
      { kind: "keyValue", entries: [{ label: "Author", value: { path: "/author" } }] },
      { kind: "section", title: "Changed files", children: [{ kind: "list", items: { path: "/files" } }] },
      { kind: "section", title: "Verification", tone: "success", children: [{ kind: "list", items: { path: "/verification" } }] },
    ],
  },
};

const changeSetArtifacts = [
  {
    label: "Validator change",
    value: {
      specVersion: "0.1",
      id: "change-set-17",
      type: typeRef(changeSetType.name, changeSetType.version),
      title: "Add semantic dateTime validation",
      createdAt: "2026-09-13T11:00:00Z",
      producer: "coding-agent/0.3.0",
      content: {
        intent: "Introduce a deterministic SafeArtifact dateTime primitive without allowing locale-dependent input.",
        author: "SafeArtifact team",
        files: ["src/schema-validator.js", "src/date-time.js", "test/date-time.test.js"],
        verification: ["Unit tests pass", "Invalid calendar dates are rejected", "Canonical source remains visible"],
      },
    },
  },
  {
    label: "Hidden text fallback",
    value: {
      specVersion: "0.1",
      id: "change-set-18",
      type: typeRef(changeSetType.name, changeSetType.version),
      title: "Demonstrate coverage fallback",
      createdAt: "2026-09-13T11:15:00Z",
      content: {
        intent: "Edit the Type Definition and remove the Verification section to see the canonical fallback.",
        author: "SafeArtifact team",
        files: ["src/coverage.js"],
        verification: ["Every content string is visible"],
      },
    },
  },
];

const queueChartType = {
  kind: "safeartifact/type-definition",
  specVersion: "0.1",
  name: "demo.queue-wait-time",
  version: "1.0.0",
  contentSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "buckets"],
    properties: {
      summary: { type: "string", maxLength: 2000 },
      buckets: {
        type: "array",
        minItems: 1,
        maxItems: 48,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["startedAt", "waitingSeconds"],
          properties: {
            startedAt: { type: "dateTime" },
            waitingSeconds: { type: "number", minimum: 0 },
          },
        },
      },
    },
  },
  view: {
    kind: "stack",
    gap: "large",
    children: [
      { kind: "text", value: { path: "/summary" }, emphasis: "lead" },
      {
        kind: "timeBarChart",
        title: "Oldest queued job",
        tone: "info",
        items: { path: "/buckets" },
        time: { path: "/startedAt" },
        value: { path: "/waitingSeconds" },
        bucket: { size: 5, unit: "minute" },
      },
    ],
  },
};

const queueChartArtifacts = [
  {
    label: "Stable queue",
    value: {
      specVersion: "0.1",
      id: "queue-window-001",
      type: typeRef(queueChartType.name, queueChartType.version),
      title: "Tenant queue wait time",
      createdAt: "2026-09-13T12:30:00Z",
      producer: "admission-monitor/0.1.0",
      content: {
        summary: "The oldest queued job stayed below the 10-second reaction objective.",
        buckets: [
          { startedAt: "2026-09-13T12:00:00Z", waitingSeconds: 2.1 },
          { startedAt: "2026-09-13T12:05:00Z", waitingSeconds: 3.4 },
          { startedAt: "2026-09-13T12:10:00Z", waitingSeconds: 4.2 },
          { startedAt: "2026-09-13T12:15:00Z", waitingSeconds: 3.7 },
          { startedAt: "2026-09-13T12:20:00Z", waitingSeconds: 5.1 },
          { startedAt: "2026-09-13T12:25:00Z", waitingSeconds: 4.4 },
        ],
      },
    },
  },
  {
    label: "Queue spike",
    value: {
      specVersion: "0.1",
      id: "queue-window-002",
      type: typeRef(queueChartType.name, queueChartType.version),
      title: "Tenant queue wait time",
      createdAt: "2026-09-13T13:00:00Z",
      producer: "admission-monitor/0.1.0",
      content: {
        summary: "Queue wait time spiked for three buckets and recovered after capacity increased.",
        buckets: [
          { startedAt: "2026-09-13T12:30:00Z", waitingSeconds: 4.8 },
          { startedAt: "2026-09-13T12:35:00Z", waitingSeconds: 8.2 },
          { startedAt: "2026-09-13T12:40:00Z", waitingSeconds: 18.7 },
          { startedAt: "2026-09-13T12:45:00Z", waitingSeconds: 31.4 },
          { startedAt: "2026-09-13T12:50:00Z", waitingSeconds: 22.6 },
          { startedAt: "2026-09-13T12:55:00Z", waitingSeconds: 7.3 },
        ],
      },
    },
  },
];

export const examples = [
  { id: "deployment", label: "Deployment status", definition: deploymentType, artifacts: deploymentArtifacts },
  { id: "test-run", label: "Test run summary", definition: testRunType, artifacts: testRunArtifacts },
  { id: "change-set", label: "Change-set", definition: changeSetType, artifacts: changeSetArtifacts },
  { id: "queue-chart", label: "Time bar chart", definition: queueChartType, artifacts: queueChartArtifacts },
];
