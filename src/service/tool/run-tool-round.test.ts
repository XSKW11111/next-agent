import { expect, test } from "vitest";
import { runToolRound, type ToolCall } from "./run-tool-round";

type Gate<Result> = {
  readonly promise: Promise<Result>;
  readonly open: (value: Result) => void;
};

function gate<Result>(): Gate<Result> {
  let open: ((value: Result) => void) | undefined;
  const promise = new Promise<Result>((resolve) => {
    open = resolve;
  });
  if (open === undefined) {
    throw new Error("gate did not open");
  }
  return { promise, open };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("two parallel tools start before either finishes", async () => {
  const starts: string[] = [];
  const search = gate<string>();
  const claim = gate<string>();
  const calls: readonly ToolCall<string>[] = [
    {
      tool: "search_products",
      run: () => {
        starts.push("search");
        return search.promise;
      },
    },
    {
      tool: "claim_early_risers",
      run: () => {
        starts.push("claim");
        return claim.promise;
      },
    },
  ];

  const round = runToolRound(calls);
  await nextTurn();
  expect(starts).toEqual(["search", "claim"]);

  search.open("products");
  claim.open("code");
  expect(await round).toEqual({ ok: true, results: ["products", "code"] });
});

test("two lookup_order calls run in emission order", async () => {
  const starts: string[] = [];
  const first = gate<string>();
  const calls: readonly ToolCall<string>[] = [
    {
      tool: "lookup_order",
      run: () => {
        starts.push("first");
        return first.promise;
      },
    },
    {
      tool: "lookup_order",
      run: () => {
        starts.push("second");
        return Promise.resolve("order-2");
      },
    },
  ];

  const round = runToolRound(calls);
  await nextTurn();
  expect(starts).toEqual(["first"]);

  first.open("order-1");
  expect(await round).toEqual({ ok: true, results: ["order-1", "order-2"] });
  expect(starts).toEqual(["first", "second"]);
});

test("capture_handoff calls run in emission order", async () => {
  const starts: string[] = [];
  const first = gate<string>();
  const calls: readonly ToolCall<string>[] = [
    {
      tool: "capture_handoff",
      run: () => {
        starts.push("first");
        return first.promise;
      },
    },
    {
      tool: "capture_handoff",
      run: () => {
        starts.push("second");
        return Promise.resolve("draft-2");
      },
    },
  ];

  const round = runToolRound(calls);
  await nextTurn();
  expect(starts).toEqual(["first"]);

  first.open("draft-1");
  expect(await round).toEqual({ ok: true, results: ["draft-1", "draft-2"] });
  expect(starts).toEqual(["first", "second"]);
});

test("mixed lanes return results in call order", async () => {
  const starts: string[] = [];
  const order = gate<string>();
  const search = gate<string>();
  const handoff = gate<string>();
  const calls: readonly ToolCall<string>[] = [
    {
      tool: "lookup_order",
      run: () => {
        starts.push("lookup");
        return order.promise;
      },
    },
    {
      tool: "search_products",
      run: () => {
        starts.push("search");
        return search.promise;
      },
    },
    {
      tool: "lookup_order",
      run: () => {
        starts.push("lookup-again");
        return Promise.resolve("order-2");
      },
    },
    {
      tool: "capture_handoff",
      run: () => {
        starts.push("handoff");
        return handoff.promise;
      },
    },
    {
      tool: "claim_early_risers",
      run: () => {
        starts.push("claim");
        return Promise.resolve("claimed");
      },
    },
    {
      tool: "capture_handoff",
      run: () => {
        starts.push("handoff-again");
        return Promise.resolve("draft-2");
      },
    },
  ];

  const round = runToolRound(calls);
  await nextTurn();
  expect(starts).toEqual(["lookup", "search", "handoff", "claim"]);

  search.open("products");
  handoff.open("draft-1");
  await nextTurn();
  expect(starts).toEqual(["lookup", "search", "handoff", "claim", "handoff-again"]);

  order.open("order-1");
  expect(await round).toEqual({
    ok: true,
    results: ["order-1", "products", "order-2", "draft-1", "claimed", "draft-2"],
  });
  expect(starts).toEqual([
    "lookup",
    "search",
    "handoff",
    "claim",
    "handoff-again",
    "lookup-again",
  ]);
});

test("a ninth call is rejected before any tool runs", async () => {
  let runs = 0;
  const calls: ToolCall<string>[] = Array.from({ length: 9 }, () => ({
    tool: "search_products",
    run: () => {
      runs += 1;
      return Promise.resolve("ran");
    },
  }));

  expect(await runToolRound(calls)).toEqual({ ok: false, reason: "too_many_calls" });
  expect(runs).toBe(0);
});
