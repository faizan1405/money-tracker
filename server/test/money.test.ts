import { describe, expect, it } from "vitest";
import { toPaise, toRupees } from "../src/money.js";
import { toIstDate } from "../src/dto.js";

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

describe("dates", () => {
  it("timestamps are stored as the India calendar day", () => {
    expect(toIstDate("2026-10-05T19:00:00.000Z")).toBe("2026-10-06"); // 00:30 IST next day
    expect(toIstDate("2026-10-05T10:00:00.000Z")).toBe("2026-10-05");
    expect(toIstDate("2026-10-05")).toBe("2026-10-05");
  });
});
