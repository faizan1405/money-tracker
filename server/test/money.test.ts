import { describe, expect, it } from "vitest";
import { toPaise, toRupees } from "../src/money.js";

describe("money", () => {
  it("converts rupees to exact paise", () => {
    expect(toPaise(1234.56)).toBe(123456);
    expect(toPaise("0.1")).toBe(10);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(-5)).toBe(-500);
    expect(toRupees(123456)).toBe(1234.56);
  });
  it("rejects more than 2 decimals and non-numbers", () => {
    expect(() => toPaise(1.005)).toThrow();
    expect(() => toPaise(Number.NaN)).toThrow();
    expect(() => toPaise("12,00")).toThrow();
  });
});
