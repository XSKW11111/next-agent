import { expect, test } from "vitest";
import { parseProduct } from "./product";

test("parseProduct accepts a name and a stock level", () => {
  expect(parseProduct({ name: "  Camp Mug  ", stockLevel: 4 })).toEqual({
    ok: true,
    value: { name: "Camp Mug", stockLevel: 4 },
  });
});

test("parseProduct rejects a price", () => {
  expect(parseProduct({ name: "Camp Mug", stockLevel: 4, price: 12 })).toEqual({
    ok: false,
  });
});
