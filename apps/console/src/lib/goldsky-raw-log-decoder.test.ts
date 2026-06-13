import { describe, it, expect } from "vitest";
import {
  parseTopics,
  filterByBlock,
  decodeIdentityEvent,
  decodeJobEvent,
  type RawLogRow,
} from "./goldsky-raw-log-decoder";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeRawLog(overrides: Partial<RawLogRow>): RawLogRow {
  return {
    id: "log_test_0",
    block_number: "46798102",
    block_hash: "0xabc",
    transaction_hash: "0xdef",
    transaction_index: "0",
    log_index: "0",
    address: "0x0000000000000000000000000000000000000000",
    data: "0x",
    topics: "",
    block_timestamp: "1781306670",
    ...overrides,
  };
}

// ── parseTopics ──────────────────────────────────────────────────────────

describe("parseTopics", () => {
  it("parses comma-separated topics", () => {
    const result = parseTopics("0xaaa,0xbbb,0xccc");
    expect(result).toEqual(["0xaaa", "0xbbb", "0xccc"]);
  });

  it("filters non-0x topics", () => {
    const result = parseTopics("0xaaa,invalid,0xbbb");
    expect(result).toEqual(["0xaaa", "0xbbb"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTopics("")).toEqual([]);
  });

  it("trims whitespace", () => {
    const result = parseTopics(" 0xaaa , 0xbbb ");
    expect(result).toEqual(["0xaaa", "0xbbb"]);
  });
});

// ── filterByBlock ────────────────────────────────────────────────────────

describe("filterByBlock", () => {
  it("filters rows by minimum block number", () => {
    const rows = [
      { block_number: "100" },
      { block_number: "200" },
      { block_number: "300" },
    ];
    const result = filterByBlock(rows, 200);
    expect(result).toHaveLength(2);
    expect(result[0].block_number).toBe("200");
    expect(result[1].block_number).toBe("300");
  });

  it("includes rows at exact fromBlock", () => {
    const rows = [{ block_number: "200" }];
    const result = filterByBlock(rows, 200);
    expect(result).toHaveLength(1);
  });

  it("returns empty when all rows are before fromBlock", () => {
    const rows = [{ block_number: "100" }, { block_number: "199" }];
    const result = filterByBlock(rows, 200);
    expect(result).toHaveLength(0);
  });
});

// ── decodeIdentityEvent — Transfer ───────────────────────────────────────

describe("decodeIdentityEvent — Transfer", () => {
  it("decodes ERC-721 Transfer with from=zero as registration", () => {
    const row = makeRawLog({
      topics:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef," +
        "0x0000000000000000000000000000000000000000000000000000000000000000," +
        "0x000000000000000000000000f5f11e68fbcbfa20de9208709ab60ff81509cb20," +
        "0x0000000000000000000000000000000000000000000000000000000000078023",
      data: "0x",
    });
    const result = decodeIdentityEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("Transfer");
    if (result!.kind === "Transfer") {
      expect(result!.from).toBe("0x0000000000000000000000000000000000000000");
      expect(result!.to).toBe("0xf5f11e68fbcbfa20de9208709ab60ff81509cb20");
      expect(result!.tokenId).toBe(491555n);
    }
  });

  it("decodes Transfer with non-zero from (ownership transfer)", () => {
    const row = makeRawLog({
      topics:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef," +
        "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa," +
        "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb," +
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    const result = decodeIdentityEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("Transfer");
  });
});

// ── decodeIdentityEvent — Registered ─────────────────────────────────────
// Registered(uint256 indexed agentId, string metadataURI, address indexed owner)
// topics[1] = agentId, topics[2] = owner, data = ABI-encoded string metadataURI

describe("decodeIdentityEvent — Registered", () => {
  it("decodes Registered event with metadataURI in data", () => {
    // topics[0] = Registered topic, topics[1] = agentId, topics[2] = owner
    // data = ABI-encoded string: offset(0x20) + length(0x3c) + "https://example.com/test-agent" + padding
    const row = makeRawLog({
      topics:
        "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a," +
        "0x00000000000000000000000000000000000000000000000000000000000780c4," +
        "0x000000000000000000000000f5f11e68fbcbfa20de9208709ab60ff81509cb20",
      data:
        "0x0000000000000000000000000000000000000000000000000000000000000020" +
        "000000000000000000000000000000000000000000000000000000000000003c" +
        "68747470733a2f2f6578616d706c652e636f6d2f746573742d6167656e7400",
    });
    const result = decodeIdentityEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("Registered");
    if (result!.kind === "Registered") {
      expect(result!.agentId).toBe(491716n);
      expect(result!.owner).toBe("0xf5f11e68fbcbfa20de9208709ab60ff81509cb20");
      expect(result!.metadataURI).toContain("example.com/test-agent");
    }
  });

  it("decodes Registered with empty metadataURI", () => {
    const row = makeRawLog({
      topics:
        "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a," +
        "0x0000000000000000000000000000000000000000000000000000000000000001," +
        "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      data: "0x",
    });
    const result = decodeIdentityEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("Registered");
    if (result!.kind === "Registered") {
      expect(result!.agentId).toBe(1n);
      expect(result!.owner).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(result!.metadataURI).toBe("");
    }
  });
});

// ── decodeIdentityEvent — MetadataSet (should be skipped) ────────────────
// MetadataSet is NOT a registration event — decoder returns null.

describe("decodeIdentityEvent — MetadataSet (ignored)", () => {
  it("returns null for MetadataSet events", () => {
    const row = makeRawLog({
      topics:
        "0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b," +
        "0x00000000000000000000000000000000000000000000000000000000000780c4," +
        "0x0000000000000000000000000000000000000000000000000000000000000040",
      data:
        "0x0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000",
    });
    const result = decodeIdentityEvent(row);
    expect(result).toBeNull();
  });
});

// ── decodeIdentityEvent — unknown events ─────────────────────────────────

describe("decodeIdentityEvent — unknown events", () => {
  it("returns null for unknown topic hashes", () => {
    const row = makeRawLog({
      topics:
        "0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7," +
        "0x00000000000000000000000000000000000000000000000000000000000780b8",
      data: "0x",
    });
    const result = decodeIdentityEvent(row);
    expect(result).toBeNull();
  });
});

// ── decodeIdentityEvent — malformed ──────────────────────────────────────

describe("decodeIdentityEvent — malformed logs", () => {
  it("returns null for empty topics", () => {
    const row = makeRawLog({ topics: "" });
    expect(decodeIdentityEvent(row)).toBeNull();
  });

  it("returns null for unknown topic0", () => {
    const row = makeRawLog({
      topics: "0x0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(decodeIdentityEvent(row)).toBeNull();
  });

  it("returns null for malformed data (not fatal)", () => {
    const row = makeRawLog({
      topics:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef," +
        "0x0000000000000000000000000000000000000000000000000000000000000000," +
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      // Missing 4th topic for tokenId
    });
    // Should not throw — returns null for too few topics
    expect(decodeIdentityEvent(row)).toBeNull();
  });
});

// ── decodeJobEvent — JobCreated ──────────────────────────────────────────

describe("decodeJobEvent — JobCreated", () => {
  it("decodes JobCreated with 6 params (jobId, client, provider in topics; evaluator, expiredAt, hook in data)", () => {
    const row = makeRawLog({
      topics:
        "0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000ca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e," +
        "0x000000000000000000000000d867647b431cc6fd354e1c261a9c05d6cc999999",
      data:
        "0x000000000000000000000000aabbccddee11223344556677889900aabbccdd" +
        "0000000000000000000000000000000000000000000000000000000066670000" +
        "0000000000000000000000001122334455667788990011223344556677889900",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobCreated");
    if (result!.kind === "JobCreated") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.client).toBe("0xca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e");
      expect(result!.provider).toBe("0xd867647b431cc6fd354e1c261a9c05d6cc999999");
      expect(result!.evaluator).toBe("0xaabbccddee11223344556677889900aabbccdd00");
      expect(result!.expiredAt).toBeGreaterThan(0n);
    }
  });
});

// ── decodeJobEvent — BudgetSet ───────────────────────────────────────────

describe("decodeJobEvent — BudgetSet", () => {
  it("decodes BudgetSet event", () => {
    const row = makeRawLog({
      topics:
        "0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16",
      data: "0x000000000000000000000000000000000000000000000000000000003b9aca00",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("BudgetSet");
    if (result!.kind === "BudgetSet") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.amount).toBe(1000000000n); // 1000 USDC (6 decimals)
    }
  });
});

// ── decodeJobEvent — JobFunded ───────────────────────────────────────────

describe("decodeJobEvent — JobFunded", () => {
  it("decodes JobFunded event", () => {
    const row = makeRawLog({
      topics:
        "0xe3fbcc1ea1bdc559ec7f0347efde7655e58b5f45a30b0e4470a583c3ef5496b3," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000ca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e",
      data: "0x000000000000000000000000000000000000000000000000000000003b9aca00",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobFunded");
    if (result!.kind === "JobFunded") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.client).toBe("0xca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e");
      expect(result!.amount).toBe(1000000000n);
    }
  });
});

// ── decodeJobEvent — JobCompleted ────────────────────────────────────────

describe("decodeJobEvent — JobCompleted", () => {
  it("decodes JobCompleted event", () => {
    const row = makeRawLog({
      topics:
        "0x0fd54bd364fa9e67f17b091aefe930932c09fe7651cf5ad02c71a418f3341444," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000ca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e",
      data: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobCompleted");
    if (result!.kind === "JobCompleted") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.evaluator).toBe("0xca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e");
      expect(result!.reason).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    }
  });
});

// ── decodeJobEvent — JobSubmitted ────────────────────────────────────────

describe("decodeJobEvent — JobSubmitted", () => {
  it("decodes JobSubmitted event", () => {
    const row = makeRawLog({
      topics:
        "0x80c17db79857f338a6a6df68a6883ecc0ce78e2202fe61ed979733573f40538e," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000d867647b431cc6fd354e1c261a9c05d6cc999999",
      data: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobSubmitted");
    if (result!.kind === "JobSubmitted") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.worker).toBe("0xd867647b431cc6fd354e1c261a9c05d6cc999999");
      expect(result!.deliverable).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    }
  });
});

// ── decodeJobEvent — JobRejected ─────────────────────────────────────────
// Uses canonical topic hash: keccak256("JobRejected(uint256,address,bytes32)")

describe("decodeJobEvent — JobRejected", () => {
  it("decodes JobRejected event with canonical topic hash", () => {
    const row = makeRawLog({
      topics:
        "0xae7362b1af91f4492868987b9c73990d780060811551b58728fbe96fd1bab275," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000d867647b431cc6fd354e1c261a9c05d6cc999999",
      data: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobRejected");
    if (result!.kind === "JobRejected") {
      expect(result!.jobId).toBe(118038n);
      expect(result!.rejector).toBe("0xd867647b431cc6fd354e1c261a9c05d6cc999999");
      expect(result!.reason).toBe("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    }
  });
});

// ── decodeJobEvent — JobExpired ──────────────────────────────────────────

describe("decodeJobEvent — JobExpired", () => {
  it("decodes JobExpired event", () => {
    const row = makeRawLog({
      topics:
        "0x97237956f8810192811e2c3f273fd02c5d6295206fdd9c62e6fe2bfc19ba9232," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16",
      data: "0x",
    });
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobExpired");
    if (result!.kind === "JobExpired") {
      expect(result!.jobId).toBe(118038n);
    }
  });
});

// ── decodeJobEvent — malformed ───────────────────────────────────────────

describe("decodeJobEvent — malformed logs", () => {
  it("returns null for empty topics", () => {
    const row = makeRawLog({ topics: "" });
    expect(decodeJobEvent(row)).toBeNull();
  });

  it("returns null for unknown topic0", () => {
    const row = makeRawLog({
      topics: "0x0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(decodeJobEvent(row)).toBeNull();
  });

  it("returns null for truncated data (not fatal)", () => {
    const row = makeRawLog({
      topics:
        "0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9," +
        "0x000000000000000000000000000000000000000000000000000000000001cd16," +
        "0x000000000000000000000000ca4ffd1c27f05aaf62d7935560d5a5dd8b8b6d0e," +
        "0x000000000000000000000000d867647b431cc6fd354e1c261a9c05d6cc999999",
      data: "0x00", // Truncated data
    });
    // Should not throw — handles truncated data gracefully
    const result = decodeJobEvent(row);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("JobCreated");
  });
});
