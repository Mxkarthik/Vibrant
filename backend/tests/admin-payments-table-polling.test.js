const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * PaymentsPage Table & Polling Lifecycle State Controller
 * Replicates the state transitions, race-condition guards,
 * background polling ref-closures, and State A/B/C logic from PaymentsPage.tsx.
 */
class PaymentsLifecycleHarness {
  constructor(apiClient) {
    this.api = apiClient;
    this.type = "individual";
    this.params = { page: 1, limit: 20, search: "", status: "ALL" };
    this.selectedEventId = "";
    this.records = [];
    this.total = 0;
    this.totalPages = 0;
    this.loading = true;
    this.refreshing = false;
    this.error = null;
    this.refreshWarning = null;
    this.selected = null;

    // Refs
    this.requestId = 0;
    this.recordsRef = [];
    this.latestPoll = null;

    this._updatePollRef();
  }

  _updatePollRef() {
    this.latestPoll = async () => {
      await this.loadPayments({ isBackground: true });
    };
  }

  changeTab(nextType) {
    if (nextType === this.type) return;
    this.requestId++;
    this.type = nextType;
    this.params = { ...this.params, page: 1, search: "" };
    this.selected = null;
    this.refreshWarning = null;
    this.records = [];
    this.recordsRef = [];
    this.loading = true;
    this._updatePollRef();
  }

  setSearch(search) {
    this.requestId++;
    this.params = { ...this.params, search, page: 1 };
    this.loading = true;
    this._updatePollRef();
  }

  setStatus(status) {
    this.requestId++;
    this.params = { ...this.params, status, page: 1 };
    this.loading = true;
    this._updatePollRef();
  }

  setSelected(record) {
    this.selected = record;
  }

  async loadPayments(options = {}) {
    const isBackground = options.isBackground ?? false;
    const currentRequestId = ++this.requestId;

    if (!isBackground) {
      this.loading = true;
      this.error = null;
    } else {
      this.refreshing = true;
    }

    try {
      const queryParams = {
        ...this.params,
        ...(this.selectedEventId ? { eventId: this.selectedEventId } : {}),
      };

      const response =
        this.type === "individual"
          ? await this.api.getIndividualPayments(queryParams)
          : await this.api.getTeamPayments(queryParams);

      // Defensive validation
      if (!response || !Array.isArray(response.payments)) {
        throw new Error("Invalid response format received from payments API.");
      }

      // Stale or superseded request guard
      if (currentRequestId !== this.requestId) {
        return;
      }

      this.records = response.payments;
      this.recordsRef = response.payments;
      this.total = response.pagination?.total ?? response.payments.length;
      this.totalPages = response.pagination?.totalPages ?? 1;
      this.error = null;
      this.refreshWarning = null;

      // Keep currently viewed modal record synchronized
      if (this.selected) {
        const matching = response.payments.find(r => r.id === this.selected.id);
        this.selected = matching || this.selected;
      }
    } catch (requestError) {
      if (currentRequestId !== this.requestId) {
        return;
      }

      const message = requestError?.message || "Payment records could not be loaded.";

      // State B: If records already exist or this was a background refresh,
      // preserve existing records and show nonblocking warning banner
      if (isBackground || this.recordsRef.length > 0) {
        this.refreshWarning = "Unable to refresh payments. Showing last updated data.";
      } else {
        // State A error
        this.error = message;
      }
    } finally {
      if (currentRequestId === this.requestId) {
        this.loading = false;
        this.refreshing = false;
      }
    }
  }

  async triggerBackgroundPoll() {
    if (this.latestPoll) {
      await this.latestPoll();
    }
  }
}

// Generate 36 mock team payment records
function generateMockTeams(count = 36) {
  return Array.from({ length: count }, (_, i) => ({
    id: `team_${i + 1}`,
    teamName: `Team ${i + 1}`,
    memberCount: 2,
    method: i % 2 === 0 ? "CASH" : "UPI",
    status: "PENDING",
    expectedAmount: 200,
    receivedAmount: null,
  }));
}

describe("Admin Payments — Table Polling, Race Conditions & State Integrity", () => {
  // Test 1 — Initial success
  it("Test 1 — Initial success: API returns 36 team transactions, renders records", async () => {
    const teams = generateMockTeams(36);
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => ({ success: true, payments: teams, pagination: { total: 36, totalPages: 2 } }),
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();

    assert.equal(harness.records.length, 36);
    assert.equal(harness.total, 36);
    assert.equal(harness.loading, false);
    assert.equal(harness.error, null);
    assert.equal(harness.refreshWarning, null);
  });

  // Test 2 — Successful polling
  it("Test 2 — Successful polling: 15-second background poll preserves team transactions without clearing table", async () => {
    const teams = generateMockTeams(36);
    let callCount = 0;
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => {
        callCount++;
        return { success: true, payments: teams, pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    // Simulate 15-second poll tick
    await harness.triggerBackgroundPoll();

    assert.equal(callCount, 2);
    assert.equal(harness.records.length, 36);
    assert.equal(harness.total, 36);
    assert.equal(harness.loading, false, "Background poll must NOT set loading to true (State C)");
    assert.equal(harness.refreshWarning, null);
  });

  // Test 3 — Network error (State B)
  it("Test 3 — Network error: Background refresh preserves existing 36 records and shows nonblocking warning (State B)", async () => {
    const teams = generateMockTeams(36);
    let shouldFail = false;
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => {
        if (shouldFail) throw new Error("Network Error");
        return { success: true, payments: teams, pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    // Network drops
    shouldFail = true;
    await harness.triggerBackgroundPoll();

    assert.equal(harness.records.length, 36, "Records must NOT be wiped out on network failure");
    assert.equal(harness.error, null, "Hard full-page error must NOT be set when records exist");
    assert.equal(harness.refreshWarning, "Unable to refresh payments. Showing last updated data.");
  });

  // Test 4 — HTTP 500
  it("Test 4 — HTTP 500: Server error preserves existing transactions and displays nonblocking retry notice", async () => {
    const teams = generateMockTeams(36);
    let shouldFail = false;
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => {
        if (shouldFail) throw new Error("Request failed with status code 500");
        return { success: true, payments: teams, pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    shouldFail = true;
    await harness.triggerBackgroundPoll();

    assert.equal(harness.records.length, 36);
    assert.equal(harness.refreshWarning, "Unable to refresh payments. Showing last updated data.");
  });

  // Test 5 — Invalid response structure
  it("Test 5 — Invalid response: Malformed data does not erase records or normalize silently to empty array", async () => {
    const teams = generateMockTeams(36);
    let returnMalformed = false;
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => {
        if (returnMalformed) return { success: true, payments: "corrupted_string" };
        return { success: true, payments: teams, pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    returnMalformed = true;
    await harness.triggerBackgroundPoll();

    assert.equal(harness.records.length, 36, "Must not normalize malformed response to []");
    assert.equal(harness.refreshWarning, "Unable to refresh payments. Showing last updated data.");
  });

  // Test 6 — Genuine empty list (State A)
  it("Test 6 — Genuine empty list: Search or filter legitimately returning 0 results shows State A", async () => {
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async (params) => {
        if (params.search === "nonexistent_team") {
          return { success: true, payments: [], pagination: { total: 0, totalPages: 0 } };
        }
        return { success: true, payments: generateMockTeams(36), pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    // Search for nonexistent team
    harness.setSearch("nonexistent_team");
    await harness.loadPayments();

    assert.equal(harness.records.length, 0);
    assert.equal(harness.total, 0);
    assert.equal(harness.error, null);
    assert.equal(harness.refreshWarning, null, "Genuine empty list must NOT show refresh warning");
  });

  // Test 7 — Out-of-order responses (Race conditions)
  it("Test 7 — Out-of-order responses: Slower stale request resolving after newer request is discarded", async () => {
    let slowResolve;
    const slowPromise = new Promise(resolve => { slowResolve = resolve; });

    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async (params) => {
        if (params.search === "slow_query") {
          await slowPromise;
          return { success: true, payments: [{ id: "stale_1" }], pagination: { total: 1, totalPages: 1 } };
        }
        return { success: true, payments: generateMockTeams(36), pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");

    // Request 1: slow search query starts
    harness.setSearch("slow_query");
    const req1 = harness.loadPayments();

    // Request 2: user clears search immediately (faster query)
    harness.setSearch("");
    const req2 = harness.loadPayments();
    await req2;

    assert.equal(harness.records.length, 36, "Newer request accepted");

    // Now slow Request 1 finally finishes
    slowResolve();
    await req1;

    assert.equal(harness.records.length, 36, "Stale Request 1 was discarded by requestId check");
  });

  // Test 8 — Review modal persistence
  it("Test 8 — Review modal: Open pending transaction remains open and synchronized during polling", async () => {
    const teams = generateMockTeams(36);
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => ({ success: true, payments: teams, pagination: { total: 36, totalPages: 2 } }),
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();

    // Administrator opens modal for team_3
    harness.setSelected(harness.records[2]);
    assert.equal(harness.selected.id, "team_3");

    // Background poll occurs
    await harness.triggerBackgroundPoll();

    assert.ok(harness.selected, "Modal selected state must NOT be cleared");
    assert.equal(harness.selected.id, "team_3");
  });

  // Test 9 — Tab switching
  it("Test 9 — Tab switching: Individual → Teams → Individual → Teams preserves correct state", async () => {
    const teams = generateMockTeams(36);
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => ({ success: true, payments: teams, pagination: { total: 36, totalPages: 2 } }),
    };

    const harness = new PaymentsLifecycleHarness(mockApi);

    // Initial Individual tab
    await harness.loadPayments();
    assert.equal(harness.type, "individual");
    assert.equal(harness.records.length, 0);

    // Switch to Teams
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.type, "team");
    assert.equal(harness.records.length, 36);

    // Switch back to Individual
    harness.changeTab("individual");
    await harness.loadPayments();
    assert.equal(harness.type, "individual");
    assert.equal(harness.records.length, 0);

    // Switch to Teams again
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.type, "team");
    assert.equal(harness.records.length, 36);
  });

  // Test 10 — Payment verification
  it("Test 10 — Payment verification: Status update preserves table rows and updates verified status in All statuses", async () => {
    const teams = generateMockTeams(36);
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => ({ success: true, payments: teams, pagination: { total: 36, totalPages: 2 } }),
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();

    // Admin verifies team_1
    teams[0] = { ...teams[0], status: "VERIFIED", receivedAmount: 200 };
    await harness.loadPayments();

    assert.equal(harness.records.length, 36, "Row count unchanged in All statuses");
    assert.equal(harness.records[0].status, "VERIFIED");
    assert.equal(harness.records[0].receivedAmount, 200);
  });

  // Test 11 — Multiple refresh cycles
  it("Test 11 — Multiple refresh cycles: Five consecutive polling cycles keep team transactions visible without degradation", async () => {
    const teams = generateMockTeams(36);
    let pollCount = 0;
    const mockApi = {
      getIndividualPayments: async () => ({ success: true, payments: [], pagination: { total: 0, totalPages: 0 } }),
      getTeamPayments: async () => {
        pollCount++;
        return { success: true, payments: teams, pagination: { total: 36, totalPages: 2 } };
      },
    };

    const harness = new PaymentsLifecycleHarness(mockApi);
    harness.changeTab("team");
    await harness.loadPayments();
    assert.equal(harness.records.length, 36);

    // Simulate 5 consecutive 15-second polling intervals
    for (let cycle = 1; cycle <= 5; cycle++) {
      await harness.triggerBackgroundPoll();
      assert.equal(harness.records.length, 36, `Cycle ${cycle}: records must remain 36`);
      assert.equal(harness.loading, false, `Cycle ${cycle}: loading must be false`);
      assert.equal(harness.error, null, `Cycle ${cycle}: error must be null`);
      assert.equal(harness.refreshWarning, null, `Cycle ${cycle}: refreshWarning must be null`);
    }

    assert.equal(pollCount, 6, "1 initial load + 5 background poll cycles executed");
  });
});
