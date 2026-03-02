import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime, formatDuration } from "../utils/time.js";

describe("utils/time — relativeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 'just now' for recent dates", () => {
    const now = new Date();
    expect(relativeTime(now)).toBe("just now");
  });

  it("should return minutes ago", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("should return hours ago", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("should return days ago", () => {
    const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("7d ago");
  });

  it("should return months ago for old dates", () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("2mo ago");
  });
});

describe("utils/time — formatDuration", () => {
  it("should format minutes only", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    const end = new Date("2026-01-01T10:45:00Z");
    expect(formatDuration(start, end)).toBe("45m");
  });

  it("should format hours and minutes", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    const end = new Date("2026-01-01T12:30:00Z");
    expect(formatDuration(start, end)).toBe("2h 30m");
  });

  it("should format zero duration", () => {
    const date = new Date("2026-01-01T10:00:00Z");
    expect(formatDuration(date, date)).toBe("0m");
  });

  it("should format exact hours", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    const end = new Date("2026-01-01T13:00:00Z");
    expect(formatDuration(start, end)).toBe("3h 0m");
  });
});
